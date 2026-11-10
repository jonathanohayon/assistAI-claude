import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId, sessionIsAdmin } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { agentConfigs, outboundAgents, users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { featuresForPlan } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import { PLANS } from "@/lib/plans";
import { getTileToggles } from "@/lib/tile-toggles";
import { TOOL_NAMES } from "@/lib/tools/admin-names";
import { accountTransferNumber, outboundCapabilities, receptionistCapabilities } from "@/lib/tools/store";
import { writeTools } from "@/lib/tools/write";
import { upgradePlans } from "@/lib/tools/upgrade";

export const dynamic = "force-dynamic";

// The agent's tools (brick T3). Tenant scope; ?asUserId= for admins.
//   GET [?agentId=<outbound agent>] →
//     { tools, capabilities, account: { googleConnected, transferNumberSet },
//       upgrade, admin? }   — capabilities = the SAME computation as the call
//       (lib/tools/store.ts); `admin` (technical tool names) only for admins.
//   PUT [?agentId=] { tools: <partial> } → same body as GET.
//     Capability objects merge key by key; 400 invalid_tools { fields }
//     (unknown keys included). Receptionist: ALSO writes the CRM tile toggles
//     and transfer_number — the calls' read source — in one transaction.
//     Outbound: stored only (inactive until T4). No admin-only field.

type Scope = { userId: string; agentId: string | null };

async function scope(req: NextRequest): Promise<Scope | { error: Response }> {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if ("forbidden" in r) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { userId: r.userId, agentId: req.nextUrl.searchParams.get("agentId") || null };
}

async function accountOf(userId: string) {
  const [u] = await db
    .select({ plan: users.subscriptionPlan, google: users.googleRefreshToken })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u ?? null;
}

const receptionistRow = (userId: string) =>
  db
    .select({
      toolsConfig: agentConfigs.toolsConfig,
      transferNumber: agentConfigs.transferNumber,
      transferNumberParked: agentConfigs.transferNumberParked,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId))
    .limit(1);

const outboundRow = (userId: string, agentId: string) =>
  db
    .select({ toolsConfig: outboundAgents.toolsConfig })
    .from(outboundAgents)
    .where(and(eq(outboundAgents.id, agentId), eq(outboundAgents.userId, userId)))
    .limit(1);

/** The GET body, computed from what is stored now. */
async function view(s: Scope): Promise<Response> {
  const [account, matrix, isAdmin] = await Promise.all([accountOf(s.userId), getPlanFeatureMatrix(), sessionIsAdmin()]);
  if (!account) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const plan = featuresForPlan(matrix, account.plan);
  const googleConnected = Boolean(account.google);
  let result;
  let transferNumberSet: boolean;
  if (s.agentId) {
    const [row] = await outboundRow(s.userId, s.agentId);
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    result = outboundCapabilities(row.toolsConfig, googleConnected, plan);
    const [cfg] = await receptionistRow(s.userId);
    transferNumberSet = Boolean(cfg && accountTransferNumber(cfg));
  } else {
    const [row] = await receptionistRow(s.userId);
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    result = receptionistCapabilities(row, await getTileToggles(s.userId), googleConnected, plan);
    transferNumberSet = Boolean(accountTransferNumber(row));
  }
  return NextResponse.json({
    tools: result.tools,
    capabilities: result.capabilities,
    account: { googleConnected, transferNumberSet },
    upgrade: upgradePlans(result.capabilities, matrix, PLANS),
    ...(isAdmin ? { admin: { toolNames: TOOL_NAMES } } : {}),
  });
}

export async function GET(req: NextRequest) {
  const s = await scope(req);
  if ("error" in s) return s.error;
  return view(s);
}

export async function PUT(req: NextRequest) {
  const s = await scope(req);
  if ("error" in s) return s.error;
  const body = (await req.json().catch(() => null)) as { tools?: unknown } | null;

  const w = await writeTools(s.userId, s.agentId, body?.tools);
  if (!w.ok) return NextResponse.json(w.body, { status: w.status });
  await logEvent({
    source: "web",
    event: "tools_updated",
    message: s.agentId ? "Outbound agent tools updated" : "Tools updated",
    userId: s.userId,
  });
  return view(s);
}
