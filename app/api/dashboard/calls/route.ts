import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { decodeCursor, parseLimit, parsePeriod } from "@/lib/calls/core";
import { listCalls } from "@/lib/calls/query";

// GET /api/dashboard/calls[?since&until&cursor&limit&asUserId] — the tenant's
// inbound calls, newest first, with the period's figures. Shape:
// lib/calls/contract.ts CallListResponse. Read-only: no LLM, no network, no
// write. Tenant-scoped (admins via asUserId, like the other dashboard routes).
export async function GET(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const q = req.nextUrl.searchParams;
  const rawCursor = q.get("cursor");
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  // A cursor carries its period: the next pages keep the first page's period.
  const period = cursor?.period ?? parsePeriod(q.get("since"), q.get("until"));
  if (!period) return NextResponse.json({ error: "invalid_period" }, { status: 400 });

  return NextResponse.json(await listCalls({ userId: r.userId, period, limit: parseLimit(q.get("limit")), cursor }));
}
