// Dispatcher d'appels sortants — partagé entre le cron web
// (/api/cron/campaign-dispatch) et le démarrage immédiat d'une campagne
// (/api/dashboard/campaigns/[id]/status, action "start"). SERVER-ONLY.
//
// Réclame les contacts dûs (claimCampaignJobs : status running + fenêtre
// d'appel + concurrence + anti-double-dial) et origine chaque appel via
// LiveKit (dialCampaignContact). Un échec d'origination remet le contact en
// file (le worker n'a pas pris la main → pas de campaign_calls inséré).

import { logEvent } from "@/lib/logger";
import { dialCampaignContact } from "@/lib/livekit-sip-outbound";

import { claimCampaignJobs, requeueContact } from "./claim";

export interface DispatchResult {
  claimed: number;
  dialed: number;
  failed: number;
}

export async function dispatchDueJobs(limit: number): Promise<DispatchResult> {
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

  return { claimed: jobs.length, dialed, failed };
}
