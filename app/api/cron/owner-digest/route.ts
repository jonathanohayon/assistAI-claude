import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { runOwnerDigests } from "@/lib/owner-digest-run";

export const dynamic = "force-dynamic";

// GET /api/cron/owner-digest (x-internal-secret) — owner's morning WhatsApp
// digest of yesterday (Asia/Jerusalem). Schedule once a morning, e.g.
// 07:00 Israel = "0 5 * * *" UTC in winter. Safe to re-run: one digest per
// tenant per day.
export async function GET(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;
  const result = await runOwnerDigests();
  return NextResponse.json({ ok: true, ...result });
}
