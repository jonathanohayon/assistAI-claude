/**
 * Provisionne le trunk SIP SORTANT LiveKit (one-shot, ops).
 *
 * Crée un outbound trunk pointant vers le provider SIP de terminaison (ex.
 * Twilio Elastic SIP Trunk) puis imprime le SID à coller dans l'env
 * LIVEKIT_OUTBOUND_TRUNK_SID (web + worker).
 *
 * Env requis :
 *   LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET
 *   SIP_OUTBOUND_ADDRESS   ex. "my-trunk.pstn.twilio.com" (Termination URI)
 *   SIP_OUTBOUND_NUMBERS   caller-ids E.164 séparés par des virgules
 *   SIP_OUTBOUND_USER / SIP_OUTBOUND_PASS  (credentials du trunk Twilio)
 *
 * Usage :
 *   npx tsx scripts/setup-outbound-trunk.mts
 *
 * Côté Twilio (prérequis, console) :
 *   1. Elastic SIP Trunking → créer un trunk, noter le Termination URI.
 *   2. Origination : pas nécessaire (on ne fait que de l'outbound).
 *   3. Authentification : Credential List (user/pass) → SIP_OUTBOUND_USER/PASS.
 *   4. Voice → Geographic Permissions : activer les pays de destination (IL…).
 *   5. Caller IDs vérifiés / numéros achetés pour le param fromNumber.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { SIPTransport } from "@livekit/protocol";
import { SipClient } from "livekit-server-sdk";

function req(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ env manquant : ${name}`);
    process.exit(1);
  }
  return v;
}

const url = req("LIVEKIT_URL").replace(/^wss:\/\//, "https://");
const client = new SipClient(
  url,
  req("LIVEKIT_API_KEY"),
  req("LIVEKIT_API_SECRET"),
);

const address = req("SIP_OUTBOUND_ADDRESS");
const numbers = req("SIP_OUTBOUND_NUMBERS")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const trunk = await client.createSipOutboundTrunk(
  "tamara-outbound",
  address,
  numbers,
  {
    transport: SIPTransport.SIP_TRANSPORT_AUTO,
    authUsername: process.env["SIP_OUTBOUND_USER"],
    authPassword: process.env["SIP_OUTBOUND_PASS"],
  },
);

console.log("✓ Outbound trunk créé.");
console.log(`LIVEKIT_OUTBOUND_TRUNK_SID=${trunk.sipTrunkId}`);
console.log("→ Ajoute cette ligne à l'env (web + worker) puis redeploie.");
process.exit(0);
