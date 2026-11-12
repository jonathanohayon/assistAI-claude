// Rate limit for the campaign "test call" (POST /api/dashboard/campaigns/[id]/test-call):
// an immediate AI call to any E.164 number, exempt from CAMPAIGN_DISPATCH by
// design, so it needs its own ceiling. Counted in the DB (lib/rate-limit-db.ts)
// BEFORE the dial: concurrent requests can't all slip under the limit.

import { NextResponse } from "next/server";

import type { RateLimitResult } from "@/lib/rate-limit-db";

export const TEST_CALL_BUCKET = "test_call";
export const TEST_CALL_WINDOW_MS = 60 * 60_000; // rolling hour
export const TEST_CALL_PER_ACCOUNT = 10; // per account per window
export const TEST_CALL_GLOBAL = 100; // all accounts together per window

/** The opts the route passes to consumeRateLimit for `accountId`. */
export function testCallLimitOpts(accountId: string) {
  return {
    bucket: TEST_CALL_BUCKET,
    accountId,
    windowMs: TEST_CALL_WINDOW_MS,
    perAccount: TEST_CALL_PER_ACCOUNT,
    global: TEST_CALL_GLOBAL,
  };
}

/** 429 { error: "rate_limited", scope } + Retry-After for a refused attempt. */
export function testCallRateLimited(r: Extract<RateLimitResult, { ok: false }>): NextResponse {
  return NextResponse.json(
    { error: "rate_limited", scope: r.scope },
    { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } },
  );
}
