import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { resolveCall } from "@/lib/agent/resolve";
import { handleCampaignConfig } from "@/lib/agent/session-config/campaign";
import { handleInboundConfig } from "@/lib/agent/session-config/inbound";
import { originFromParams } from "@/lib/agent/session-config/origin";
import { handleOutboundTestConfig } from "@/lib/agent/session-config/outbound-test";

// GET /api/agent/session-config?origin=<kind>&… (x-internal-secret) — the
// SINGLE route the worker will read (A3; the worker switches in A4).
//   origin=phone&phone=…[&caller=][&forwardedFrom=] · origin=web&userId=… ·
//   origin=call_me&userId=… · origin=campaign&campaignId=…&contactId=… ·
//   origin=outbound_test&agentId=…   (vox → 400 external_origin)
// Serves the legacy fields EXACTLY as the old route for that origin (same
// code: lib/agent/session-config/*) plus `session`: the new shape
// { agent, account, call } from the Agent contract (lib/agent).
export async function GET(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;
  const parsed = originFromParams(req.nextUrl.searchParams);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { origin } = parsed;

  const handler =
    origin.kind === "campaign" ? handleCampaignConfig : origin.kind === "outbound_test" ? handleOutboundTestConfig : handleInboundConfig;
  const legacy = await handler(req);
  if (legacy.status !== 200) return legacy;

  // The legacy handler above already reported any default-tenant fallback.
  const resolution = await resolveCall(origin, { reportFallback: false });
  if (!resolution.ok) return legacy; // can't happen after a 200 (same lookups); serve legacy only
  const { legacyKnowledge: _lk, ...account } = resolution.resolved.account;
  void _lk;
  return NextResponse.json({
    ...(await legacy.json()),
    session: { version: 1, agent: resolution.resolved.agent, account, call: resolution.resolved.call },
  });
}
