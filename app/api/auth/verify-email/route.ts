import { NextRequest, NextResponse } from "next/server";

import { verifyDeps } from "@/lib/verification-limits/deps";
import { handleVerifyEmail } from "@/lib/verification-limits/verify";

// POST /api/auth/verify-email
// Body : { email, code }
//
// Public. Checks the 4-digit code; on success marks users.email_verified =
// true, and the page then calls signIn() in the browser (next-auth/react).
// Capped per client IP, per address and route-wide; the answer never tells
// whether the address has an account or whether it is already verified. See
// lib/verification-limits/verify.ts.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const r = await handleVerifyEmail({ body, headers: req.headers }, verifyDeps);
  return NextResponse.json(r.body, {
    status: r.status,
    headers: r.retryAfterSec ? { "Retry-After": String(r.retryAfterSec) } : undefined,
  });
}
