import { and, desc, eq, gt, SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolveScopeUserId } from "@/lib/admin-impersonate";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";

// GET /api/dashboard/events?since=<iso>&source=<csv>&level=<csv>&limit=200&asUserId=<uuid>
// Returns rows newer than `since` (exclusive) so the dashboard can poll
// efficiently — only fetching new logs each tick.
//
// Scoping :
//   - Par défaut : events.userId = session.user.id (tenant authentifié).
//   - Si `?asUserId=<uuid>` ET caller est admin → events du tenant cible.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const since = url.searchParams.get("since");
  const sourceCsv = url.searchParams.get("source") ?? "";
  const levelCsv = url.searchParams.get("level") ?? "";
  const asUserId = url.searchParams.get("asUserId");
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "200"), 1),
    500,
  );

  const scope = await resolveScopeUserId({
    sessionUserId: session.user.id,
    asUserId,
  });
  if ("forbidden" in scope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const conditions: SQL[] = [eq(events.userId, scope.userId)];
  if (since) {
    const ts = new Date(since);
    if (!Number.isNaN(ts.getTime())) {
      conditions.push(gt(events.createdAt, ts));
    }
  }

  const rows = await db
    .select()
    .from(events)
    .where(and(...conditions))
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
