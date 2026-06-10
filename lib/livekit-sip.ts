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

// Cache module-level du trunk SID résolu. Durée de vie = celle du process
// (pas de TTL) : le trunk inbound partagé ne change qu'en cas d'intervention
// manuelle, et un redeploy suffit alors à invalider le cache.
let cachedTrunkSid: string | null = null;

const resolveTrunkSid = async (): Promise<string> => {
  if (cachedTrunkSid) return cachedTrunkSid;

  // IMPORTANT : on ne remplit `cachedTrunkSid` qu'au point de succès unique
  // (fin de fonction). Si listSipInboundTrunk() throw ou si aucun trunk ne
  // convient, l'erreur remonte au caller SANS polluer le cache — le prochain
  // appel retentera une résolution complète.
  const trunks = await getClient().listSipInboundTrunk();
  const fromEnv = process.env.LIVEKIT_INBOUND_TRUNK_SID;
  let resolved: string;
  if (fromEnv) {
    // Valide le SID configuré contre les trunks réels du projet. S'il est
    // périmé (trunk supprimé/recréé, ou SID d'un autre projet LiveKit), on NE
    // plante PAS le provisioning : fallback sur le 1er trunk inbound existant.
    // Évite l'erreur "Inbound trunk … introuvable" au signup.
    if (trunks.some((t) => t.sipTrunkId === fromEnv)) {
      resolved = fromEnv;
    } else if (trunks.length > 0) {
      console.warn(
        `[livekit-sip] LIVEKIT_INBOUND_TRUNK_SID=${fromEnv} introuvable dans le projet ; fallback sur ${trunks[0].sipTrunkId}. Corrige l'env.`,
      );
      resolved = trunks[0].sipTrunkId;
    } else {
      throw new Error(
        `Inbound trunk ${fromEnv} introuvable et aucun autre trunk inbound dans ce projet LiveKit. Vérifie LIVEKIT_INBOUND_TRUNK_SID (ou crée un trunk).`,
      );
    }
  } else {
    if (trunks.length === 0) {
      throw new Error(
        "Aucun inbound trunk LiveKit trouvé. Crée-en un avec setup_sip d'abord.",
      );
    }
    resolved = trunks[0].sipTrunkId;
  }

  cachedTrunkSid = resolved;
  return resolved;
};

/**
 * Append a phone number (E.164) to the inbound trunk's allowed numbers list.
 * Idempotent: if the number is already there, no-op. Uses the
 * "update fields" endpoint so we don't have to round-trip the whole trunk.
 *
 * ⚠️ Pendant côté Twilio : un numéro acheté via purchaseNumber()
 * (lib/twilio-numbers.ts) DOIT ensuite être ajouté ici, sinon LiveKit
 * rejette les appels entrants sur ce numéro (pas dans l'allow-list du trunk).
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
