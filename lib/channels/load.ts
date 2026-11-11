// Server-side Channels for an agent and for a call (C1). Reads today's
// tables only; no write.
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs, campaigns, outboundAgents, phoneNumbers } from "@/lib/db/schema";
import {
  campaignDispatchCallerId,
  inboundCallChannel,
  outboundCallChannel,
  outboundChannels,
  receptionistChannels,
  callMeCallerId,
  WEB_CALL,
} from "@/lib/channels/adapters";
import type { CallChannel, Channels } from "@/lib/channels/contract";
import type { CallOrigin } from "@/lib/agent/contract";

const accountNumberRows = (userId: string) =>
  db
    .select({ id: phoneNumbers.id, phoneNumber: phoneNumbers.phoneNumber, label: phoneNumbers.label, countryCode: phoneNumbers.countryCode })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, userId))
    .orderBy(asc(phoneNumbers.createdAt));

/** The receptionist's channels (agentId null) or an outbound agent's; null = not found / not owned. */
export async function loadChannels(userId: string, outboundAgentId: string | null): Promise<Channels | null> {
  if (outboundAgentId) {
    const [a] = await db
      .select({ channels: outboundAgents.channels })
      .from(outboundAgents)
      .where(and(eq(outboundAgents.id, outboundAgentId), eq(outboundAgents.userId, userId)))
      .limit(1);
    return a ? outboundChannels(a.channels) : null;
  }
  const [cfg] = await db
    .select({
      forwardingBusinessPhone: agentConfigs.forwardingBusinessPhone,
      forwardingTestStartedAt: agentConfigs.forwardingTestStartedAt,
      forwardingDetectedAt: agentConfigs.forwardingDetectedAt,
      forwardingVerifiedAt: agentConfigs.forwardingVerifiedAt,
      forwardingVerifiedMethod: agentConfigs.forwardingVerifiedMethod,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId))
    .limit(1);
  if (!cfg) return null;
  return receptionistChannels(await accountNumberRows(userId), cfg);
}

/**
 * The channel of a call, by origin, as today's code paths decide it:
 * phone → the dialed number; web / outbound test → web; call_me → the
 * account's oldest number; campaign → the campaign's caller id (null =
 * trunk default). vox → null (external).
 *
 * Limit: the worker strips Twilio's `whatsapp:` prefix before asking for the
 * config, so a phone origin can't tell WhatsApp from PSTN here (pstn unless
 * the prefix is present). A4 (worker on session-config) should pass it.
 */
export async function callChannel(origin: CallOrigin): Promise<CallChannel | null> {
  switch (origin.kind) {
    case "phone":
      return inboundCallChannel(origin.calledNumber);
    case "web":
    case "outbound_test":
      return WEB_CALL;
    case "call_me": {
      const rows = await accountNumberRows(origin.userId);
      return outboundCallChannel(callMeCallerId(rows.map((r) => r.phoneNumber)));
    }
    case "campaign": {
      const [c] = await db.select({ fromNumber: campaigns.fromNumber }).from(campaigns).where(eq(campaigns.id, origin.campaignId)).limit(1);
      return c ? outboundCallChannel(campaignDispatchCallerId(c.fromNumber)) : null;
    }
    case "vox":
      return null;
  }
}
