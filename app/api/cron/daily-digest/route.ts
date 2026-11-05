import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { runDailyDigest } from "@/lib/monitoring";

// GET /api/cron/daily-digest: once a day (Railway cron, 07:05 Israel).
// Synthetic check of /api/agent/config + greeting-audio for MONITOR_TEST_PHONE,
// then a WhatsApp digest (calls, bookings, errors, heartbeat) to the founder.
export async function GET(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;
  const r = await runDailyDigest();
  return NextResponse.json({ ok: true, synthetic: r.synthetic });
}
