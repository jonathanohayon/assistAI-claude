// LiveKit SIP OUTBOUND — provisionne le trunk sortant + origine les appels
// d'une campagne (CreateSIPParticipant) en dispatchant l'agent worker dans
// la room. Distinct du trunk ENTRANT géré par lib/livekit-sip.ts.
//
// Env requis :
//   LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET
//   LIVEKIT_OUTBOUND_TRUNK_SID — SID du trunk sortant (sinon 1er trunk listé)
//   (provisioning) LIVEKIT_SIP_OUTBOUND_ADDRESS / _USER / _PASS — host SIP
//      du provider sortant (ex. Twilio Elastic SIP Trunk termination URI).

import { SIPTransport } from "@livekit/protocol";
import { AgentDispatchClient, SipClient } from "livekit-server-sdk";

// Doit matcher WORKER_AGENT_NAME du worker (app/api/livekit/web-token).
export const CAMPAIGN_AGENT_NAME = "appointment-agent";

function httpUrl(): string {
  const url = process.env.LIVEKIT_URL;
  if (!url) throw new Error("LIVEKIT_URL manquant");
  return url.replace(/^wss:\/\//, "https://");
}

function getSipClient(): SipClient {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret)
    throw new Error("LIVEKIT_API_KEY / LIVEKIT_API_SECRET manquant");
  return new SipClient(httpUrl(), key, secret);
}

function getDispatchClient(): AgentDispatchClient {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret)
    throw new Error("LIVEKIT_API_KEY / LIVEKIT_API_SECRET manquant");
  return new AgentDispatchClient(httpUrl(), key, secret);
}

let cachedOutboundTrunkSid: string | null = null;
export async function resolveOutboundTrunkSid(): Promise<string> {
  if (cachedOutboundTrunkSid) return cachedOutboundTrunkSid;
  const fromEnv = process.env.LIVEKIT_OUTBOUND_TRUNK_SID;
  if (fromEnv) {
    cachedOutboundTrunkSid = fromEnv;
    return fromEnv;
  }
  const trunks = await getSipClient().listSipOutboundTrunk();
  if (!trunks.length)
    throw new Error(
      "Aucun outbound trunk LiveKit. Crée-le via createOutboundTrunk() (scripts/setup-outbound-trunk).",
    );
  cachedOutboundTrunkSid = trunks[0].sipTrunkId;
  return cachedOutboundTrunkSid;
}

// Provisioning (ops/setup) — crée le trunk sortant pointant vers le provider
// SIP (Twilio). À lancer une fois ; renvoie le SID à mettre dans l'env.
export async function createOutboundTrunk(opts: {
  name: string;
  address: string; // ex. "my-trunk.pstn.twilio.com"
  numbers: string[]; // caller-ids autorisés (E.164)
  authUsername?: string;
  authPassword?: string;
}): Promise<string> {
  const trunk = await getSipClient().createSipOutboundTrunk(
    opts.name,
    opts.address,
    opts.numbers,
    {
      transport: SIPTransport.SIP_TRANSPORT_AUTO,
      authUsername: opts.authUsername,
      authPassword: opts.authPassword,
    },
  );
  return trunk.sipTrunkId;
}

export type DialResult = {
  roomName: string;
  participantId: string;
};

// Origine un appel sortant vers `phoneNumber` et dispatch l'agent dans la room.
// L'agent worker lit `metadata` (source=campaign + ids) pour conduire l'appel
// et poster le résultat sur /api/agent/campaign-result.
export async function dialCampaignContact(opts: {
  phoneNumber: string; // callee, E.164
  fromNumber?: string; // caller-id (doit être autorisé sur le trunk)
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

  // 1) Dispatch l'agent dans la room (il attend l'arrivée du callee).
  await getDispatchClient().createDispatch(opts.roomName, CAMPAIGN_AGENT_NAME, {
    metadata,
  });

  // 2) Compose le numéro via le trunk sortant → le callee rejoint la room.
  const participant = await getSipClient().createSipParticipant(
    trunkSid,
    opts.phoneNumber,
    opts.roomName,
    {
      participantIdentity: `callee-${opts.contactId}`,
      participantName: opts.phoneNumber,
      participantMetadata: metadata,
      fromNumber: opts.fromNumber || undefined,
      // Anti-décroché-machine basique : on laisse le worker gérer la suite.
      waitUntilAnswered: false,
    },
  );

  return {
    roomName: opts.roomName,
    participantId: participant.participantId,
  };
}
