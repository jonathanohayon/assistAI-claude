// LiveKit SIP trunk admin — append a newly-purchased Twilio number to the
// shared LiveKit inbound trunk so calls to that number get accepted and
// routed to an agent.
//
// Required env:
//   LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
//   LIVEKIT_INBOUND_TRUNK_SID — the shared trunk SID (e.g. ST_Uuu2kybYtZbK).
//   If unset, we look up the first inbound trunk on the project at runtime
//   so multi-trunk setups can override.

import { ListUpdate } from "@livekit/protocol";
import { SipClient } from "livekit-server-sdk";

const getClient = (): SipClient => {
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) {
    throw new Error("LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET manquant");
  }
  return new SipClient(url.replace(/^wss:\/\//, "https://"), key, secret);
};

let cachedTrunkSid: string | null = null;
const resolveTrunkSid = async (): Promise<string> => {
  if (cachedTrunkSid) return cachedTrunkSid;
  const fromEnv = process.env.LIVEKIT_INBOUND_TRUNK_SID;
  if (fromEnv) {
    cachedTrunkSid = fromEnv;
    return fromEnv;
  }
  const trunks = await getClient().listSipInboundTrunk();
  if (trunks.length === 0) {
    throw new Error(
      "Aucun inbound trunk LiveKit trouvé. Crée-en un avec setup_sip d'abord.",
    );
  }
  cachedTrunkSid = trunks[0].sipTrunkId;
  return cachedTrunkSid;
};

/**
 * Append a phone number (E.164) to the inbound trunk's allowed numbers list.
 * Idempotent: if the number is already there, no-op. Uses the
 * "update fields" endpoint so we don't have to round-trip the whole trunk.
 */
export async function addNumberToTrunk(phoneNumber: string): Promise<void> {
  const client = getClient();
  const trunkSid = await resolveTrunkSid();
  const trunks = await client.listSipInboundTrunk();
  const trunk = trunks.find((t) => t.sipTrunkId === trunkSid);
  if (!trunk) throw new Error(`Inbound trunk ${trunkSid} introuvable`);

  const existing = new Set(trunk.numbers ?? []);
  if (existing.has(phoneNumber)) return;

  await client.updateSipInboundTrunkFields(trunkSid, {
    numbers: new ListUpdate({ add: [phoneNumber] }),
  });
}

/**
 * Remove a phone number from the inbound trunk. Used when releasing a
 * number on subscription cancel. Idempotent.
 */
export async function removeNumberFromTrunk(
  phoneNumber: string,
): Promise<void> {
  const client = getClient();
  const trunkSid = await resolveTrunkSid();
  await client.updateSipInboundTrunkFields(trunkSid, {
    numbers: new ListUpdate({ remove: [phoneNumber] }),
  });
}
