import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema";

// Temp endpoint to fetch the most recent call's transcript. Used to scrape
// a verification code spoken to the agent. Gated by INTERNAL_SECRET.
// Remove after verification flow completes.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token || token !== process.env.INTERNAL_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [latest] = await db
    .select()
    .from(calls)
    .orderBy(desc(calls.createdAt))
    .limit(1);

  if (!latest) {
    return NextResponse.json({ error: "no calls yet" }, { status: 404 });
  }

  return NextResponse.json({
    createdAt: latest.createdAt,
    fromNumber: latest.fromNumber,
    transcript: latest.transcript,
    summary: latest.summary,
  });
}
