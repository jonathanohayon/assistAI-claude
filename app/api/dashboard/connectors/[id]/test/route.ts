import { NextRequest, NextResponse } from "next/server";

import { connectorsWriteGate, jsonBody, respond } from "@/lib/connectors/route-gate";
import { testConnector } from "@/lib/connectors/write";
import { createRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

// POST /api/dashboard/connectors/[id]/test (B4, behind CONNECTORS_WRITE):
// one mock question to that connector's agent (lib/tools/client-agent-test.ts).
//   { language?: "fr" | "he" | "en" } (default: the account's primary language)
//   → 200 { ok: true, ms, lastTestAt } | { ok: false, reason, lastTestAt }
//   — NEVER the remote body; writes last_test_at / last_test_ok ("legacy":
//   read-only, lastTestAt null). 429 rate_limited (5 per account per 10 min).
const tests = createRateLimiter({ limit: 5, windowMs: 10 * 60_000 });

export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await connectorsWriteGate(req);
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const body = await jsonBody(req);
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : body === undefined ? {} : null;
  if (!b || (b.language !== undefined && typeof b.language !== "string")) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!tests.hit(gate.actor.userId)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  return respond(await testConnector(gate.actor, id, b.language as string | undefined));
}
