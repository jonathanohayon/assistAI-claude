// Boucle de dispatch — SERVER-ONLY. Réclame les contacts dus puis compose
// chaque appel. Appelée par le cron (/api/cron/campaign-dispatch) et au
// démarrage d'une campagne (route status). Idempotent et borné par `limit`.

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { campaignContacts } from "@/lib/db/schema";
import { claimCampaignJobs } from "@/lib/campaigns/claim";
import { dialContact } from "@/lib/campaigns/dial";
import { logEvent } from "@/lib/logger";

export interface DispatchResult {
  claimed: number;
  dialed: number;
  failed: number;
}

async function requeue(contactId: string): Promise<void> {
  await db
    .update(campaignContacts)
    .set({ status: "queued", claimedAt: null })
    .where(eq(campaignContacts.id, contactId));
}

export async function dispatchDueJobs(limit: number): Promise<DispatchResult> {
  const jobs = await claimCampaignJobs(limit);
  let dialed = 0;
  let failed = 0;

  for (const job of jobs) {
    // Format parsé par le worker (detectOrigin) pour reconnaître l'appel
    // comme campagne dès l'entrée, sans dépendre de la metadata SIP/job :
    //   campaign__<campaignId>__<contactId>__<attempts>
    const roomName = `campaign__${job.campaignId}__${job.contactId}__${job.attempts}`;
    try {
      await dialContact({
        phoneNumber: job.phoneNumber,
        fromNumber: job.fromNumber || undefined,
        roomName,
        campaignId: job.campaignId,
        contactId: job.contactId,
        userId: job.userId,
      });
      // Marque "calling" — repassera en terminal via /api/agent/campaign-result.
      await db
        .update(campaignContacts)
        .set({ status: "calling" })
        .where(eq(campaignContacts.id, job.contactId));
      dialed++;
    } catch (e) {
      failed++;
      await requeue(job.contactId);
      await logEvent({
        source: "web",
        event: "campaign_dial_failed",
        level: "error",
        message: `Échec de composition ${job.phoneNumber} : ${
          e instanceof Error ? e.message : "unknown"
        }`,
        userId: job.userId,
        metadata: { campaignId: job.campaignId, contactId: job.contactId },
      });
    }
  }

  return { claimed: jobs.length, dialed, failed };
}

// Compose UN appel hors file (bouton "Appel test immédiat") : bypasse la
// fenêtre horaire et le claim. Le contact doit déjà exister (status 'calling').
export async function dialOneNow(opts: {
  phoneNumber: string;
  fromNumber?: string;
  campaignId: string;
  contactId: string;
  userId: string;
}): Promise<{ roomName: string }> {
  const roomName = `campaign-${opts.contactId}-test-${Date.now()}`;
  const res = await dialContact({ ...opts, roomName });
  return { roomName: res.roomName };
}
