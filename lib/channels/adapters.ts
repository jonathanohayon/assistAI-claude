// Today's numbers and settings → the Channels contract (C1). Pure.
// Each function reproduces EXACTLY the rule a current code path applies
// (named in its comment); scripts/tests/channels.test.ts proves it.

import {
  CHANNELS_VERSION,
  WHATSAPP_VOICE_AVAILABLE,
  type AgentNumber,
  type CallChannel,
  type Channels,
  type Forwarding,
} from "@/lib/channels/contract";

/** Twilio stores WhatsApp numbers with this prefix in phone_numbers. */
export const WHATSAPP_PREFIX = "whatsapp:";

export interface PhoneNumberRow {
  id: string;
  phoneNumber: string;
  label: string;
  countryCode: string;
}

/** A phone_numbers row as shown (app/api/dashboard/channels): channel from the prefix, prefix stripped. */
export function agentNumberFromRow(row: PhoneNumberRow): AgentNumber {
  const isWhatsapp = row.phoneNumber.startsWith(WHATSAPP_PREFIX);
  return {
    id: row.id,
    number: isWhatsapp ? row.phoneNumber.slice(WHATSAPP_PREFIX.length) : row.phoneNumber,
    channel: isWhatsapp ? "whatsapp" : "pstn",
    label: row.label,
    countryCode: row.countryCode,
  };
}

/** The legacy /api/dashboard/channels item (key `phoneNumber`), byte for byte. */
export function legacyChannelNumber(n: AgentNumber) {
  return { id: n.id, phoneNumber: n.number, channel: n.channel, label: n.label, countryCode: n.countryCode };
}

export interface ForwardingColumns {
  forwardingBusinessPhone: string;
  forwardingTestStartedAt: Date | null;
  forwardingDetectedAt: Date | null;
  forwardingVerifiedAt: Date | null;
  forwardingVerifiedMethod: string;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function forwardingFrom(c: ForwardingColumns): Forwarding {
  return {
    businessPhone: c.forwardingBusinessPhone,
    startedAt: iso(c.forwardingTestStartedAt),
    detectedAt: iso(c.forwardingDetectedAt),
    verifiedAt: iso(c.forwardingVerifiedAt),
    method: c.forwardingVerifiedMethod,
  };
}

/** The receptionist: every account number reaches it (lib/tenant.ts resolveTenantByPhone). */
export function receptionistChannels(rows: PhoneNumberRow[], forwarding: ForwardingColumns): Channels {
  return {
    version: CHANNELS_VERSION,
    recipe: "receptionist",
    numbers: rows.map(agentNumberFromRow),
    forwarding: forwardingFrom(forwarding),
    outbound: null,
    whatsappVoiceAvailable: WHATSAPP_VOICE_AVAILABLE,
  };
}

/** An outbound agent: no inbound number; its switches as normalised (lib/outbound-agents/validate.ts). */
export function outboundChannels(channels: { phone?: boolean; whatsappVoice?: boolean } | null | undefined): Channels {
  return {
    version: CHANNELS_VERSION,
    recipe: "outbound",
    numbers: [],
    forwarding: null,
    outbound: { phone: channels?.phone !== false, whatsappVoice: channels?.whatsappVoice === true },
    whatsappVoiceAvailable: WHATSAPP_VOICE_AVAILABLE,
  };
}

// ── The channel of one call, by origin ─────────────────────────────────

/** Inbound phone call: the dialed number (with Twilio's prefix for WhatsApp). */
export function inboundCallChannel(dialedRaw: string): CallChannel {
  const wa = dialedRaw.startsWith(WHATSAPP_PREFIX);
  return { channel: wa ? "whatsapp" : "pstn", direction: "inbound", agentNumber: wa ? dialedRaw.slice(WHATSAPP_PREFIX.length) : dialedRaw };
}

/** Web test call (LiveTest, outbound-agent test): no number. */
export const WEB_CALL: CallChannel = { channel: "web", direction: "inbound", agentNumber: null };

/** Campaign dispatch (lib/campaigns/dispatch.ts): the campaign's number, else the trunk default (null). */
export function campaignDispatchCallerId(campaignFromNumber: string | null | undefined): string | null {
  return campaignFromNumber || null;
}

/**
 * Campaign "test call now" (app/api/dashboard/campaigns/[id]/test-call): the
 * campaign's number (trimmed), else the account's first number AS RETURNED by
 * its query (no ORDER BY there), else none (409 no_caller_id).
 */
export function campaignTestCallerId(campaignFromNumber: string | null | undefined, accountNumbersAsQueried: string[]): string | null {
  return campaignFromNumber?.trim() || accountNumbersAsQueried[0] || null;
}

/** Call-me (app/api/dashboard/call-me): the account's OLDEST number, else none (400 no_tenant_number). */
export function callMeCallerId(accountNumbersByCreatedAt: string[]): string | null {
  return accountNumbersByCreatedAt[0] ?? null;
}

export function outboundCallChannel(callerId: string | null): CallChannel {
  return { channel: "pstn", direction: "outbound", agentNumber: callerId };
}
