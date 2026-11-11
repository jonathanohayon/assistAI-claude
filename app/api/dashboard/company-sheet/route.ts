import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { currentCompanySheet } from "@/lib/knowledge/store";
import { planCappedSheetWrite } from "@/lib/locations-cap";
import { outboundSheetEnabled } from "@/lib/knowledge/outbound-sheet";
import { logEvent } from "@/lib/logger";

// The account's company sheet (Knowledge S4). Tenant scope; ?asUserId= for admins.
//   GET → { companySheet, outboundUsesCompanySheet }  (sheet stored, or built
//         from today's business JSON; whether outbound agents read it — S5 switch)
//   PUT { companySheet: <partial> } → { companySheet }
//     top-level keys replace, identity merges key by key; also writes
//     agent_configs.business (the calls' read source), through the business
//     sanitizer. 400 invalid_company_sheet { fields } — including anything the
//     sanitizer would otherwise drop silently.
//     403 location_cap { field: "centres", cap, message } when the save ADDS
//     a location beyond the plan's cap (the TENANT's plan, also under
//     ?asUserId=); edits and deletions always pass (lib/locations-cap.ts).

async function scope(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if ("forbidden" in r) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { userId: r.userId };
}

async function load(userId: string) {
  const [row] = await db
    .select({ companySheet: users.companySheet, business: agentConfigs.business, plan: users.subscriptionPlan })
    .from(users)
    .innerJoin(agentConfigs, eq(agentConfigs.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function GET(req: NextRequest) {
  const s = await scope(req);
  if ("error" in s) return s.error;
  const row = await load(s.userId);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    companySheet: currentCompanySheet(row.companySheet, row.business),
    // Knowledge S5: do this account's outbound agents read the sheet? (server switch)
    outboundUsesCompanySheet: outboundSheetEnabled(s.userId),
  });
}

export async function PUT(req: NextRequest) {
  const s = await scope(req);
  if ("error" in s) return s.error;
  const body = (await req.json().catch(() => null)) as { companySheet?: unknown } | null;
  const row = await load(s.userId);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const plan = planCappedSheetWrite(row, body?.companySheet);
  if (!plan.ok) {
    if ("body" in plan) return NextResponse.json(plan.body, { status: plan.status });
    return NextResponse.json({ error: plan.error, fields: plan.fields }, { status: plan.status });
  }

  // ::jsonb casts: postgres-js serialises JS arrays/objects as text[] otherwise
  // (same fix as the business editor in /api/dashboard/config).
  await db.transaction(async (tx) => {
    await tx
      .update(agentConfigs)
      .set({ business: sql`${JSON.stringify(plan.business)}::jsonb`, updatedAt: new Date() } as never)
      .where(eq(agentConfigs.userId, s.userId));
    await tx
      .update(users)
      .set({ companySheet: sql`${JSON.stringify(plan.sheet)}::jsonb` } as never)
      .where(eq(users.id, s.userId));
  });
  await logEvent({ source: "web", event: "company_sheet_updated", message: "Company sheet updated", userId: s.userId });
  return NextResponse.json({ companySheet: plan.sheet, outboundUsesCompanySheet: outboundSheetEnabled(s.userId) });
}
