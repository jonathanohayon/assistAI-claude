// Production dependencies of the WhatsApp test (lib/notifications/whatsapp-test.ts):
// the saved number from the DB, the shared DB rate limiter, the real sender.
// Separate from the route so the DB test can use the same wiring with only
// the sender swapped out.

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs } from "@/lib/db/schema";
import type { WhatsAppTestDeps } from "@/lib/notifications/whatsapp-test";
import { consumeRateLimit } from "@/lib/rate-limit-db";
import { sendWhatsApp, whatsAppConfigured } from "@/lib/whatsapp";

export async function loadSavedOwnerWhatsapp(userId: string): Promise<string | null> {
  const [cfg] = await db
    .select({ ownerWhatsapp: agentConfigs.ownerWhatsapp })
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId))
    .limit(1);
  return cfg?.ownerWhatsapp ?? null;
}

export const whatsAppTestDeps: WhatsAppTestDeps = {
  loadSavedNumber: loadSavedOwnerWhatsapp,
  consumeRateLimit,
  isConfigured: whatsAppConfigured,
  templateSid: () =>
    process.env.WHATSAPP_OWNER_TEMPLATE_SID ||
    process.env.WHATSAPP_OWNER_TEMPLATE_SID_FR ||
    process.env.WHATSAPP_OWNER_TEMPLATE_SID_HE ||
    process.env.WHATSAPP_OWNER_TEMPLATE_SID_EN ||
    undefined,
  send: sendWhatsApp,
  logFailure(redactedError, userId) {
    // Server logs only (not the tenant-visible event log); numbers redacted.
    console.error(`[whatsapp-test] send failed for user ${userId}: ${redactedError}`);
  },
};
