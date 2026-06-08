// Composition d'appels sortants (campagnes) — SERVER-ONLY.
//
// Place un appel via le trunk SORTANT LiveKit (createSipParticipant) ET
// dispatch l'agent `appointment-agent` dans la même room avec le metadata
// `source=campaign`. Le worker (repo séparé) détecte ce metadata, fetch
// /api/agent/campaign-config, mène l'appel, puis POST /api/agent/campaign-result.
//
// Env requis :
//   LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET
//   LIVEKIT_OUTBOUND_TRUNK_SID — SID du trunk sortant (sinon 1er trunk sortant).

import { AgentDispatchClient, SipClient } from "livekit-server-sdk";

// Doit matcher l'agentName d'enregistrement du worker (config.ts AGENT_NAME)
// ET le dispatch explicite, sinon aucun agent ne rejoint la room.
export const CAMPAIGN_AGENT_NAME = "appointment-agent";

function lkCreds(): { url: string; key: string; secret: string } {
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) {
    throw new Error("LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET manquant");
  }
  return { url: url.replace(/^wss:\/\//, "https://"), key, secret };
}

let sip: SipClient | null = null;
function sipClient(): SipClient {
  if (sip) return sip;
  const { url, key, secret } = lkCreds();
  return (sip = new SipClient(url, key, secret));
}

let dispatch: AgentDispatchClient | null = null;
function dispatchClient(): AgentDispatchClient {
  if (dispatch) return dispatch;
  const { url, key, secret } = lkCreds();
  return (dispatch = new AgentDispatchClient(url, key, secret));
}

let cachedTrunkSid: string | null = null;
async function resolveOutboundTrunkSid(): Promise<string> {
  if (cachedTrunkSid) return cachedTrunkSid;
  const fromEnv = process.env.LIVEKIT_OUTBOUND_TRUNK_SID;
  if (fromEnv) return (cachedTrunkSid = fromEnv);
  const trunks = await sipClient().listSipOutboundTrunk();
  if (trunks.length === 0) {
    throw new Error(
      "Aucun outbound trunk LiveKit (set LIVEKIT_OUTBOUND_TRUNK_SID).",
    );
  }
  return (cachedTrunkSid = trunks[0].sipTrunkId);
}

export interface DialResult {
  roomName: string;
  participantId: string;
}

/**
 * Compose le `phoneNumber` et amène l'agent campagne dans `roomName`.
 * `fromNumber` (caller-id E.164) doit être autorisé sur le trunk sortant.
 */
export async function dialContact(opts: {
  phoneNumber: string;
  fromNumber?: string;
  roomName: string;
  campaignId: string;
  contactId: string;
  userId: string;
}): Promise<DialResult> {
  const trunkSid = await resolveOutboundTrunkSid();
  const metadata = JSON.stringify({
    source: "campaign",
    campaignId: opts.campaignId,
    contactId: opts.contactId,
    userId: opts.userId,
  });

  // 1) Agent dispatché dans la room (attend que l'appelé décroche).
  await dispatchClient().createDispatch(opts.roomName, CAMPAIGN_AGENT_NAME, {
    metadata,
  });

  // 2) Compose le numéro via le trunk sortant → l'appelé rejoint la room.
  const participant = await sipClient().createSipParticipant(
    trunkSid,
    opts.phoneNumber,
    opts.roomName,
    {
      participantIdentity: `callee-${opts.contactId}`,
      participantName: opts.phoneNumber,
      participantMetadata: metadata,
      ...(opts.fromNumber ? { fromNumber: opts.fromNumber } : {}),
      waitUntilAnswered: false,
    },
  );

  return {
    roomName: opts.roomName,
    participantId: participant.participantId,
  };
}
