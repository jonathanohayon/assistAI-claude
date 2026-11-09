import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { runMonitorTick } from "@/lib/monitoring";

// GET /api/cron/monitor: every 5 min (Railway cron). Worker heartbeat
// freshness + model keys reported by the worker -> critical alerts.
export async function GET(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;
  const r = await runMonitorTick();
  return NextResponse.json({ ok: !r.problem && r.deadKeys.length === 0, problem: r.problem, deadKeys: r.deadKeys });
}
