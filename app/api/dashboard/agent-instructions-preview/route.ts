import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId, sessionIsAdmin } from "@/lib/api/auth-guards";
import {
  inboundSessionInstructions,
  inboundTenantSections,
  outboundSessionInstructions,
} from "@/lib/agent/session-instructions";
import { loadInboundInstructionsInput, loadOutboundTestInstructionsInput } from "@/lib/agent/session-instructions-load";
import { resolveTenantByUserId } from "@/lib/tenant";

// GET /api/dashboard/agent-instructions-preview[?asUserId=][&agentId=]
// What the agent receives, from the SAME functions as the call routes
// (saved state). No agentId = the receptionist; agentId = an outbound
// agent's test call.
//   admin  → { scope: "full", instructions, greeting }   (the exact text)
//   tenant → { scope: "tenant", parts: { greeting, companySheet, instructions } }
//            ONLY their own parts, built from the same pieces — the per-plan
//            admin directives are never in this shape (tamaraVP, 11/11).
export async function GET(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const isAdmin = await sessionIsAdmin();
  const agentId = req.nextUrl.searchParams.get("agentId");

  if (agentId) {
    const o = await loadOutboundTestInstructionsInput(agentId, r.userId);
    if (!o) return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
    return NextResponse.json(
      isAdmin
        ? { scope: "full", instructions: outboundSessionInstructions(o.input), greeting: o.greeting }
        : { scope: "tenant", parts: { greeting: o.greeting, companySheet: o.knowledge, instructions: o.agentInstructions } },
    );
  }

  const tenant = await resolveTenantByUserId(r.userId);
  if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { input, greeting } = await loadInboundInstructionsInput(tenant);
  if (isAdmin) {
    return NextResponse.json({ scope: "full", instructions: inboundSessionInstructions(input), greeting });
  }
  const own = inboundTenantSections(input);
  return NextResponse.json({ scope: "tenant", parts: { greeting, companySheet: own.companySheet, instructions: own.instructions } });
}
