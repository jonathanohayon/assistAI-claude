import { asc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { db } from "@/lib/db";
import { agentConfigs, phoneNumbers } from "@/lib/db/schema";
import {
  CANCEL_TEST_PATCH,
  FORWARDING_TEST_WINDOW_MS,
  forwardingStatus,
  parsePhone,
} from "@/lib/forwarding-test";

// Call-forwarding check for the onboarding wizard (contract sent to FE):
//   POST { businessPhone? } → start (or restart) a 10-min test window; the
//                            first inbound call to the tenant's number in it
//                            verifies forwarding (no caller-ID matching)
//   GET                  → status idle | waiting | detected | expired
//   DELETE               → cancel: clears the window only (status idle);
//                          never touches a past verification; idempotent
// Tenant scope; admins via ?asUserId= like the other dashboard routes.

async function tenantNumber(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ phoneNumber: phoneNumbers.phoneNumber })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, userId))
    .orderBy(asc(phoneNumbers.createdAt))
    .limit(1);
  return row?.phoneNumber ?? null;
}

async function scope(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if ("forbidden" in r) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { userId: r.userId };
}

function view(
  cfg: {
    forwardingTestStartedAt: Date | null;
    forwardingBusinessPhone: string;
    forwardingDetectedAt: Date | null;
    forwardingVerifiedAt: Date | null;
    forwardingVerifiedMethod: string;
  },
  number: string | null,
) {
  const now = new Date();
  const started = cfg.forwardingTestStartedAt;
  return {
    status: forwardingStatus(cfg, now),
    startedAt: started?.toISOString() ?? null,
    expiresAt: started ? new Date(started.getTime() + FORWARDING_TEST_WINDOW_MS).toISOString() : null,
    detectedAt: cfg.forwardingDetectedAt?.toISOString() ?? null,
    verifiedAt: cfg.forwardingVerifiedAt?.toISOString() ?? null,
    verifiedMethod: cfg.forwardingVerifiedMethod || null,
    tenantNumber: number,
    businessPhone: cfg.forwardingBusinessPhone || null,
  };
}

const FIELDS = {
  forwardingTestStartedAt: agentConfigs.forwardingTestStartedAt,
  forwardingBusinessPhone: agentConfigs.forwardingBusinessPhone,
  forwardingDetectedAt: agentConfigs.forwardingDetectedAt,
  forwardingVerifiedAt: agentConfigs.forwardingVerifiedAt,
  forwardingVerifiedMethod: agentConfigs.forwardingVerifiedMethod,
};

export async function GET(req: NextRequest) {
  const s = await scope(req);
  if ("error" in s) return s.error;
  const [cfg] = await db.select(FIELDS).from(agentConfigs).where(eq(agentConfigs.userId, s.userId)).limit(1);
  if (!cfg) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(view(cfg, await tenantNumber(s.userId)));
}

export async function POST(req: NextRequest) {
  const s = await scope(req);
  if ("error" in s) return s.error;
  const parsed = await parseJsonBody<{ businessPhone?: unknown }>(req);
  if (!parsed.ok) return parsed.response;

  // Optional: the usual business number the owner forwards FROM. Only used
  // to recognise a forward header (stronger proof); never required.
  const given = parsed.data?.businessPhone;
  let businessPhone = "";
  if (typeof given === "string" && given.trim()) {
    const p = parsePhone(given);
    if (!p) return NextResponse.json({ error: "invalid_business_phone" }, { status: 400 });
    businessPhone = p;
  }

  const number = await tenantNumber(s.userId);
  if (!number) return NextResponse.json({ error: "no_tenant_number" }, { status: 400 });

  const [exists] = await db
    .select({ id: agentConfigs.id })
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, s.userId))
    .limit(1);
  if (!exists) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [updated] = await db
    .update(agentConfigs)
    .set({ forwardingTestStartedAt: sql`now()`, forwardingBusinessPhone: businessPhone })
    .where(eq(agentConfigs.userId, s.userId))
    .returning(FIELDS);
  return NextResponse.json(view(updated, number));
}

export async function DELETE(req: NextRequest) {
  const s = await scope(req);
  if ("error" in s) return s.error;
  const [updated] = await db
    .update(agentConfigs)
    .set(CANCEL_TEST_PATCH)
    .where(eq(agentConfigs.userId, s.userId))
    .returning(FIELDS);
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(view(updated, await tenantNumber(s.userId)));
}
