import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { campaignCalls, campaignContacts, campaigns } from "@/lib/db/schema";
import { resolveTargetUserId } from "@/lib/campaigns/scope";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

// GET — agrégats pour le dashboard de résultats animé (funnel, dispositions,
// sentiment, KPIs).
export async function GET(req: NextRequest, ctx: Ctx) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, r.userId)))
    .limit(1);
  if (!campaign)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [contacts] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(campaignContacts)
    .where(eq(campaignContacts.campaignId, id));

  // Agrégats funnel + KPI en une passe.
  const [agg] = await db
    .select({
      dialed: sql<number>`count(*)::int`,
      connected: sql<number>`count(*) filter (where outcome = 'connected')::int`,
      engaged: sql<number>`count(*) filter (where outcome = 'connected' and duration_seconds > 15)::int`,
      qualified: sql<number>`count(*) filter (where disposition in ('qualified','interested','meeting_booked','callback'))::int`,
      converted: sql<number>`count(*) filter (where disposition = 'meeting_booked')::int`,
      avgDuration: sql<number>`coalesce(round(avg(duration_seconds) filter (where outcome = 'connected')), 0)::int`,
      costCents: sql<number>`coalesce(sum(cost_cents), 0)::int`,
      posSent: sql<number>`count(*) filter (where sentiment = 'positive')::int`,
      neuSent: sql<number>`count(*) filter (where sentiment = 'neutral')::int`,
      negSent: sql<number>`count(*) filter (where sentiment = 'negative')::int`,
    })
    .from(campaignCalls)
    .where(eq(campaignCalls.campaignId, id));

  const dispoRows = await db
    .select({
      disposition: campaignCalls.disposition,
      n: sql<number>`count(*)::int`,
    })
    .from(campaignCalls)
    .where(eq(campaignCalls.campaignId, id))
    .groupBy(campaignCalls.disposition);

  const outcomeRows = await db
    .select({
      outcome: campaignCalls.outcome,
      n: sql<number>`count(*)::int`,
    })
    .from(campaignCalls)
    .where(eq(campaignCalls.campaignId, id))
    .groupBy(campaignCalls.outcome);

  return NextResponse.json({
    totalContacts: contacts?.total ?? 0,
    funnel: {
      dialed: agg?.dialed ?? 0,
      connected: agg?.connected ?? 0,
      engaged: agg?.engaged ?? 0,
      qualified: agg?.qualified ?? 0,
      converted: agg?.converted ?? 0,
    },
    kpis: {
      calls: agg?.dialed ?? 0,
      connected: agg?.connected ?? 0,
      qualified: agg?.qualified ?? 0,
      avgDurationSeconds: agg?.avgDuration ?? 0,
      costCents: agg?.costCents ?? 0,
    },
    sentiment: {
      positive: agg?.posSent ?? 0,
      neutral: agg?.neuSent ?? 0,
      negative: agg?.negSent ?? 0,
    },
    dispositions: Object.fromEntries(
      dispoRows.filter((d) => d.disposition).map((d) => [d.disposition, d.n]),
    ),
    outcomes: Object.fromEntries(outcomeRows.map((o) => [o.outcome, o.n])),
  });
}
