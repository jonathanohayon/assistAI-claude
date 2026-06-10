import { and, desc, eq, gt, inArray, SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";

// Internal-only read of recent app_events. Same shape as the dashboard
// endpoint but gated by INTERNAL_SECRET so headless tooling (debug, AI
// agent investigations) can read without a session cookie.
//
// GET ?source=latency,tenant&level=warn,error&since=ISO&limit=50
export async function GET(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;

  const url = req.nextUrl;
  const sourceCsv = url.searchParams.get("source") ?? "";
  const levelCsv = url.searchParams.get("level") ?? "";
  const since = url.searchParams.get("since");
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "50"), 1),
    500,
  );

  const conditions: SQL[] = [];
  if (since) {
    const ts = new Date(since);
    if (!Number.isNaN(ts.getTime())) {
      conditions.push(gt(events.createdAt, ts));
    }
  }
  const sources = sourceCsv
    ? sourceCsv.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  const levels = levelCsv
    ? levelCsv.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  if (sources && sources.length > 0) {
    conditions.push(inArray(events.source, sources));
  }
  if (levels && levels.length > 0) {
    conditions.push(
      inArray(events.level, levels as ("info" | "warn" | "error")[]),
    );
  }
  void eq;

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db
    .select()
    .from(events)
    .where(where)
    .orderBy(desc(events.createdAt))
    .limit(limit);

  return NextResponse.json({
    events: rows,
    count: rows.length,
    serverTime: new Date().toISOString(),
  });
}
