import { and, desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { campaignCalls, campaignContacts, campaigns } from "@/lib/db/schema";
import { resolveTargetUserId } from "@/lib/campaigns/scope";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

// GET — snapshot live d'une campagne pour le monitoring (polling ~2-3 s).
export async function GET(req: NextRequest, ctx: Ctx) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const [campaign] = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, r.userId)))
    .limit(1);
  if (!campaign)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      queued: sql<number>`count(*) filter (where status = 'queued')::int`,
      inFlight: sql<number>`count(*) filter (where status in ('claimed','calling'))::int`,
      done: sql<number>`count(*) filter (where status in ('completed','failed','no_answer','voicemail','busy','skipped'))::int`,
      connected: sql<number>`count(*) filter (where status = 'completed')::int`,
    })
    .from(campaignContacts)
    .where(eq(campaignContacts.campaignId, id));

  // Répartition des issues + dispositions sur les appels enregistrés.
  const outcomeRows = await db
    .select({
      outcome: campaignCalls.outcome,
      n: sql<number>`count(*)::int`,
    })
    .from(campaignCalls)
    .where(eq(campaignCalls.campaignId, id))
    .groupBy(campaignCalls.outcome);

  const dispoRows = await db
    .select({
      disposition: campaignCalls.disposition,
      n: sql<number>`count(*)::int`,
    })
    .from(campaignCalls)
    .where(eq(campaignCalls.campaignId, id))
    .groupBy(campaignCalls.disposition);

  const recent = await db
    .select({
      id: campaignCalls.id,
      phoneNumber: campaignCalls.phoneNumber,
      outcome: campaignCalls.outcome,
      disposition: campaignCalls.disposition,
      sentiment: campaignCalls.sentiment,
      summary: campaignCalls.summary,
      durationSeconds: campaignCalls.durationSeconds,
      createdAt: campaignCalls.createdAt,
    })
    .from(campaignCalls)
    .where(eq(campaignCalls.campaignId, id))
    .orderBy(desc(campaignCalls.createdAt))
    .limit(15);

  const totalCalls = outcomeRows.reduce((s, o) => s + o.n, 0);
  const connectedCalls =
    outcomeRows.find((o) => o.outcome === "connected")?.n ?? 0;
  const pickupRate =
    totalCalls > 0 ? Math.round((connectedCalls / totalCalls) * 100) : 0;

  return NextResponse.json({
    status: campaign.status,
    counts: counts ?? { total: 0, queued: 0, inFlight: 0, done: 0, connected: 0 },
    pickupRate,
    outcomes: Object.fromEntries(outcomeRows.map((o) => [o.outcome, o.n])),
    dispositions: Object.fromEntries(
      dispoRows.filter((d) => d.disposition).map((d) => [d.disposition, d.n]),
    ),
    recent,
  });
}
