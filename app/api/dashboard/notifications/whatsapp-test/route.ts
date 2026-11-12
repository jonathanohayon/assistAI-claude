import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { runWhatsAppTest } from "@/lib/notifications/whatsapp-test";
import { whatsAppTestDeps } from "@/lib/notifications/whatsapp-test-deps";

export const dynamic = "force-dynamic";

// Sends ONE WhatsApp test message to the account's SAVED owner number
// (agent_configs.owner_whatsapp). Session scope; ?asUserId=<tenant> for
// admins (that tenant's saved number). Logic: lib/notifications/whatsapp-test.ts.
//
//   POST { to? } — `to` is optional; when sent it must equal the saved number.
//   200 { ok: true }
//   400 invalid_number · 401 Unauthorized · 403 Forbidden (asUserId, non-admin)
//   403 recipient_not_allowed · 409 no_saved_number
//   429 { error: "rate_limited", scope: "account" | "global" } (+ Retry-After)
//   502 send_failed · 503 not_configured
// Never a provider name, env var name or raw provider error in a response.

export async function POST(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // The display name goes only in a capped template variable, and only for
  // the account's own test (an admin testing a tenant sends no name).
  const session = await auth();
  const own = session?.user?.id === r.userId;
  const displayName = own ? (session?.user?.name ?? null) : null;

  const body = await req.json().catch(() => ({}));
  const out = await runWhatsAppTest({ userId: r.userId, displayName, body }, whatsAppTestDeps);
  return NextResponse.json(out.body, { status: out.status, headers: out.headers });
}
