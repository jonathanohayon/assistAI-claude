import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { dispatchDueJobs } from "@/lib/campaigns/dispatch";

// GET /api/cron/campaign-dispatch?limit=N  (x-internal-secret)
// Tourne périodiquement (Railway cron) : réclame les contacts dus et compose
// les appels. Borné par `limit`.

export async function GET(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit")) || 10, 1),
    50,
  );
  const result = await dispatchDueJobs(limit);
  return NextResponse.json({ ok: true, ...result });
}
