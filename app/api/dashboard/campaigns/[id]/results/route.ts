import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { campaignCalls, campaigns, outboundAgents } from "@/lib/db/schema";
import { analyzeCampaignCall } from "@/lib/campaigns/analyze";
import { resolveTargetUserId } from "@/lib/campaigns/scope";

// Node runtime (analyse LLM). L'analyse paresseuse peut prendre du temps.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Ctx {
  params: Promise<{ id: string }>;
}

// Combien d'appels non encore analysés on traite par requête (borne latence ;
// les suivants seront analysés au prochain chargement).
const ANALYZE_BUDGET = 24;
const ANALYZE_CONCURRENCY = 5;

// GET /api/dashboard/campaigns/[id]/results?asUserId=
// Renvoie les discussions de la campagne (transcriptions + verdict critères de
// succès + sentiment + résumé) et des agrégats pour les graphes. Analyse
// paresseusement (LLM) les appels connectés pas encore analysés et met en
// cache le résultat dans campaign_calls.
export async function GET(req: NextRequest, ctx: Ctx) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, r.userId)))
    .limit(1);
  if (!campaign)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  const rows = await db
    .select()
    .from(campaignCalls)
    .where(eq(campaignCalls.campaignId, id))
    .orderBy(desc(campaignCalls.createdAt))
    .limit(500);

  // ── Analyse paresseuse des appels connectés non encore analysés ─────────
  // Critère de succès : niveau campagne. Langue : depuis l'agent, fallback "fr".
  const agent = campaign.agentId
    ? ((
        await db
          .select({ language: outboundAgents.language })
          .from(outboundAgents)
          .where(eq(outboundAgents.id, campaign.agentId))
          .limit(1)
      )[0] ?? null)
    : null;
  const successCriteria = campaign.successCriteria || "";
  const language = agent?.language ?? "fr";
  const toAnalyze = rows.filter(
    (c) =>
      c.outcome === "connected" &&
      Array.isArray(c.transcript) &&
      c.transcript.length > 0 &&
      !c.summary,
  );
  let analyzed = 0;
  const queue = toAnalyze.slice(0, ANALYZE_BUDGET);
  for (let i = 0; i < queue.length; i += ANALYZE_CONCURRENCY) {
    const batch = queue.slice(i, i + ANALYZE_CONCURRENCY);
    await Promise.all(
      batch.map(async (c) => {
        const a = await analyzeCampaignCall({
          transcript: c.transcript,
          objective: campaign.objective,
          successCriteria,
          language,
        });
        if (!a) return;
        analyzed++;
        c.disposition = a.success;
        c.sentiment = a.sentiment;
        c.summary = a.summary;
        await db
          .update(campaignCalls)
          .set({ disposition: a.success, sentiment: a.sentiment, summary: a.summary })
          .where(eq(campaignCalls.id, c.id));
      }),
    );
  }

  // ── Agrégats pour les graphes ───────────────────────────────────────────
  const byOutcome: Record<string, number> = {};
  const bySentiment: Record<string, number> = {};
  const perDayMap = new Map<string, number>();
  let connected = 0;
  let success = 0;
  let partial = 0;
  let totalSeconds = 0;
  for (const c of rows) {
    byOutcome[c.outcome] = (byOutcome[c.outcome] ?? 0) + 1;
    totalSeconds += c.durationSeconds ?? 0;
    if (c.outcome === "connected") {
      connected++;
      if (c.sentiment) bySentiment[c.sentiment] = (bySentiment[c.sentiment] ?? 0) + 1;
      if (c.disposition === "success") success++;
      else if (c.disposition === "partial") partial++;
    }
    const day = c.createdAt.toISOString().slice(0, 10);
    perDayMap.set(day, (perDayMap.get(day) ?? 0) + 1);
  }
  const perDay = [...perDayMap.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({
    campaign: {
      id: campaign.id,
      name: campaign.name,
      objective: campaign.objective,
      successCriteria,
    },
    aggregates: {
      total: rows.length,
      connected,
      success,
      partial,
      successRate: connected > 0 ? Math.round((success / connected) * 100) : 0,
      avgDurationSec: rows.length
        ? Math.round(totalSeconds / rows.length)
        : 0,
      totalMinutes: Math.round(totalSeconds / 60),
      byOutcome,
      bySentiment,
      perDay,
      analyzedNow: analyzed,
      pendingAnalysis: Math.max(0, toAnalyze.length - queue.length),
    },
    calls: rows.map((c) => ({
      id: c.id,
      phoneNumber: c.phoneNumber,
      outcome: c.outcome,
      durationSeconds: c.durationSeconds ?? 0,
      success: c.disposition || null,
      sentiment: c.sentiment || null,
      summary: c.summary || "",
      transcript: Array.isArray(c.transcript) ? c.transcript : [],
      createdAt: c.createdAt.toISOString(),
    })),
  });
}
