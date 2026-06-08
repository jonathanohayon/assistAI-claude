import { NextRequest, NextResponse } from "next/server";

import { dispatchDueJobs } from "@/lib/campaigns/dispatch";

// GET /api/cron/campaign-dispatch?limit=N  (x-internal-secret)
// Tourne périodiquement (Railway cron) : réclame les contacts dus et compose
// les appels. Borné par `limit`.

export async function GET(req: NextRequest) {
  const expected = process.env.INTERNAL_SECRET;
  const provided = req.headers.get("x-internal-secret");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit")) || 10, 1),
    50,
  );
  const result = await dispatchDueJobs(limit);
  return NextResponse.json({ ok: true, ...result });
}
