// POST /api/live-test/token (and the deprecated alias) — the handler, with
// every I/O injected: the route wires the real ones (lib/live-test/deps.ts),
// tests inject fakes, so no test ever signs with real credentials.
//
// Responses (neutral strings only: no supplier name, no configuration name,
// no raw error):
//   200 { url, token, roomName, identity }   unchanged from before the limit
//   401 { error: "Unauthorized" }            no session
//   403 { error: "Forbidden" }               ?asUserId by a non-admin
//   429 { error: "rate_limited", scope: "account" | "global" } + Retry-After
//   500 { error: "not_configured" }          signer not configured
//   503 { error: "unavailable" }             limiter unavailable (fails closed)

import { NextResponse, type NextRequest } from "next/server";

import type { LiveTestError } from "@/lib/live-test/policy";
import type { RateLimitResult, RateLimitScope } from "@/lib/rate-limit-db-core";

export interface LiveTestTokenResponse {
  url: string;
  token: string;
  roomName: string;
  identity: string;
}

export interface LiveTestDeps {
  /** The signed-in user (NextAuth session), or null. */
  session(): Promise<{ userId: string; email: string | null } | null>;
  /** True when the signer has its url + credentials. */
  configured(): boolean;
  /** Admin scoping (resolveScopeUserId). */
  resolveScope(sessionUserId: string, asUserId: string | null): Promise<{ userId: string } | { forbidden: true }>;
  /** Counts the attempt for this account (consumeRateLimit, bucket "live_test"). */
  claim(userId: string): Promise<RateLimitResult>;
  /** The outbound agent's id if it belongs to `userId`, else null. */
  findOutboundAgent(agentId: string, userId: string): Promise<string | null>;
  /** Signs the room token (lib/live-test/mint.ts). */
  mint(input: { userId: string; email: string | null; testAgentId: string | null }): Promise<LiveTestTokenResponse>;
  /** Server-side log of a limiter failure (no response detail). */
  logLimiterError(userId: string, e: unknown): Promise<void>;
}

const fail = (error: LiveTestError, status: number, scope?: RateLimitScope, retryAfterSec?: number) =>
  NextResponse.json(scope ? { error, scope } : { error }, {
    status,
    headers: retryAfterSec ? { "Retry-After": String(retryAfterSec) } : undefined,
  });

export async function handleLiveTestToken(req: NextRequest, deps: LiveTestDeps): Promise<NextResponse> {
  const session = await deps.session();
  if (!session) return fail("Unauthorized", 401);
  if (!deps.configured()) return fail("not_configured", 500);

  // Optional body: empty = test the scoped tenant's inbound agent.
  // asUserId: admins may test another tenant (403 otherwise).
  const body = (await req.json().catch(() => ({}))) as { asUserId?: string; agentId?: string };
  const scope = await deps.resolveScope(session.userId, body.asUserId ?? null);
  if ("forbidden" in scope) return fail("Forbidden", 403);
  const userId = scope.userId;

  // Counted BEFORE signing, atomically, against the tenant the token is for.
  let verdict: RateLimitResult;
  try {
    verdict = await deps.claim(userId);
  } catch (e) {
    await deps.logLimiterError(userId, e).catch(() => {});
    return fail("unavailable", 503);
  }
  if (!verdict.ok) return fail("rate_limited", 429, verdict.scope, verdict.retryAfterSec);

  // Live test of an OUTBOUND agent: only one that belongs to the scoped tenant.
  const testAgentId =
    typeof body.agentId === "string" && body.agentId ? await deps.findOutboundAgent(body.agentId, userId) : null;

  return NextResponse.json(await deps.mint({ userId, email: session.email, testAgentId }));
}
