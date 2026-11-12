import { NextRequest, NextResponse } from "next/server";

import { resendDeps } from "@/lib/verification-limits/deps";
import { handleResendVerification } from "@/lib/verification-limits/resend";

// POST /api/auth/resend-verification
// Body : { email }
//
// Public. Capped per address (1 per 60 s, 5 per day) and route-wide (per
// hour); the answer never tells whether the address has an account. See
// lib/verification-limits/resend.ts.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const r = await handleResendVerification(body, resendDeps);
  return NextResponse.json(r.body, {
    status: r.status,
    headers: r.retryAfterSec ? { "Retry-After": String(r.retryAfterSec) } : undefined,
  });
}
