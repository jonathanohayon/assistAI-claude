// The Channels contract (brick C1): where an agent can be reached and how it
// calls out — its numbers, WhatsApp, the call forwarding check, the caller id
// of an outbound call. Pure, client-safe (no DB import).
//
// C1 = contract + adapters on today's data (lib/channels/adapters.ts), with
// NO behaviour change: every number still belongs to the ACCOUNT and reaches
// its one receptionist; outbound caller ids still come from each campaign.
// Attaching a number to an agent is C3; several receptionists per account C4.

export const CHANNELS_VERSION = 1 as const;

export type NumberChannel = "pstn" | "whatsapp";

export interface AgentNumber {
  id: string;
  /** E.164, never the Twilio `whatsapp:` prefix. */
  number: string;
  channel: NumberChannel;
  label: string;
  countryCode: string;
}

/** The account's call-forwarding check (onboarding wizard), receptionist only. */
export interface Forwarding {
  businessPhone: string;
  startedAt: string | null;
  detectedAt: string | null;
  verifiedAt: string | null;
  method: string;
}

export interface Channels {
  version: typeof CHANNELS_VERSION;
  recipe: "receptionist" | "outbound";
  /** Numbers that reach this agent (today: every account number → the receptionist). */
  numbers: AgentNumber[];
  forwarding: Forwarding | null;
  /** An outbound agent's switches (stored; dialing is PSTN only today). */
  outbound: { phone: boolean; whatsappVoice: boolean } | null;
  /** WhatsApp voice is shown only once Meta allows it for the account. */
  whatsappVoiceAvailable: boolean;
}

/**
 * Meta Business Calling is not opted in yet: WhatsApp voice is not usable,
 * so no screen offers it (spec decision 3). One constant to flip.
 */
export const WHATSAPP_VOICE_AVAILABLE = false;

/** The channel of ONE call, by origin. */
export interface CallChannel {
  channel: NumberChannel | "web";
  direction: "inbound" | "outbound";
  /** The agent-side number: dialed (inbound) or shown as caller id (outbound); null = none / trunk default. */
  agentNumber: string | null;
}
