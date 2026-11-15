import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { campaignCalls, campaigns } from "@/lib/db/schema";
import { isAnalysisPending } from "@/lib/campaigns/analysis";
import { resolveTargetUserId } from "@/lib/campaigns/scope";
import { outboundCampaignsGate } from "@/lib/campaigns/plan-gate";
import { captureMode } from "@/lib/campaigns/capture-mode";
import { resultsCallView } from "@/lib/campaigns/results-call-view";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

// GET /api/dashboard/campaigns/[id]/results?asUserId=
// Renvoie les discussions de la campagne (transcriptions + verdict critères de
// succès + sentiment + résumé) et des agrégats pour les graphes.
// Read-only: returns what is stored; the analysis runs after the call.
export async function GET(req: NextRequest, ctx: Ctx) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Plan gate (same rule as the UI): admins, or plans with outbound_campaigns.
  const planGate = await outboundCampaignsGate();
  if (planGate) return planGate;

  const { id } = await ctx.params;
  const mode = captureMode();
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

  // READ-ONLY: no LLM call, no write. The analysis runs after the call
  // (lib/campaigns/analysis.ts); a call not analysed yet shows success null,
  // sentiment null, summary "" (as before its analysis). analyzedNow stays in
  // the shape and is always 0; pendingAnalysis counts the calls still
  // waiting for their analysis.
  const successCriteria = campaign.successCriteria || "";
  const now = new Date();
  const pendingAnalysis = rows.filter((c) => isAnalysisPending(c, now)).length;

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
      analyzedNow: 0,
      pendingAnalysis,
    },
    // `captured` (M3a) is present ONLY when CAMPAIGN_CAPTURE is on.
    calls: rows.map((c) => resultsCallView(c, mode)),
  });
}
