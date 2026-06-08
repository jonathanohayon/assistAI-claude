import { NextRequest, NextResponse } from "next/server";

import { logEvent } from "@/lib/logger";
import { claimCampaignJobs, requeueContact } from "@/lib/campaigns/claim";
import { dialCampaignContact } from "@/lib/livekit-sip-outbound";

export const dynamic = "force-dynamic";

// Cron dispatcher (architecture recommandée) : réclame les contacts dûs et
// origine les appels sortants via LiveKit (CreateSIPParticipant) en
// dispatchant l'agent worker dans chaque room. L'agent conduit l'appel puis
// poste le résultat sur /api/agent/campaign-result.
//
// Auth : x-internal-secret. À hooker sur le scheduler Railway (toutes les ~30s
// à 1 min). `?limit=N` borne le nombre d'appels initiés par tick (défaut 10).
//
// NB : ne PAS activer en même temps que le worker-poll (/api/agent/campaign-
// jobs) — un seul dialer doit tourner, sinon double-claim/double-dial.
export async function GET(req: NextRequest) {
  const expected = process.env.INTERNAL_SECRET;
  const provided = req.headers.get("x-internal-secret");
  if (!expected || provided !== expected)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit")) || 10, 1),
    50,
  );

  const jobs = await claimCampaignJobs(limit);
  let dialed = 0;
  let failed = 0;

  for (const job of jobs) {
    const roomName = `campaign-${job.contactId}-${job.attempts}`;
    try {
      await dialCampaignContact({
        phoneNumber: job.phoneNumber,
        fromNumber: job.fromNumber,
        roomName,
        campaignId: job.campaignId,
        contactId: job.contactId,
        userId: job.userId,
      });
      dialed++;
    } catch (e) {
      failed++;
      // Échec d'origination AVANT toute conversation → on repose en file
      // (le worker n'a pas pris la main, donc pas de campaign_calls inséré).
      await requeueContact(job.contactId);
      await logEvent({
        source: "agent",
        event: "campaign_dial_failed",
        message: `Échec d'origination ${job.phoneNumber}`,
        level: "warn",
        userId: job.userId,
        metadata: {
          campaignId: job.campaignId,
          contactId: job.contactId,
          error: e instanceof Error ? e.message : String(e),
        },
      });
    }
  }

  return NextResponse.json({ ok: true, claimed: jobs.length, dialed, failed });
}
