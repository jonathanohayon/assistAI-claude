import { and, desc, gt, SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";

// GET /api/dashboard/events?since=<iso>&source=<csv>&level=<csv>&limit=200
// Returns rows newer than `since` (exclusive) so the dashboard can poll
// efficiently — only fetching new logs each tick.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const since = url.searchParams.get("since");
  const sourceCsv = url.searchParams.get("source") ?? "";
  const levelCsv = url.searchParams.get("level") ?? "";
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "200"), 1),
    500,
  );

  const conditions: SQL[] = [];
  if (since) {
    const ts = new Date(since);
    if (!Number.isNaN(ts.getTime())) {
      conditions.push(gt(events.createdAt, ts));
    }
  }

  // Drizzle's IN takes an array. Build the where clause dynamically.
  // For simplicity use raw SQL fragments here.
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(events)
    .where(where)
    .orderBy(desc(events.createdAt))
    .limit(limit);

  const sources = sourceCsv ? new Set(sourceCsv.split(",").filter(Boolean)) : null;
  const levels = levelCsv ? new Set(levelCsv.split(",").filter(Boolean)) : null;

  const filtered = rows
    .filter((r) => !sources || sources.has(r.source))
    .filter((r) => !levels || levels.has(r.level));

  return NextResponse.json({
    events: filtered,
    serverTime: new Date().toISOString(),
  });
}
