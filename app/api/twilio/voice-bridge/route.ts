import { NextRequest } from "next/server";

// Twilio Voice webhook → LiveKit SIP bridge.
//
// Twilio POSTs an inbound call here (application/x-www-form-urlencoded). We
// answer with TwiML that <Dial>s the shared LiveKit SIP trunk, which fans the
// call out to the agent worker. This single bridge serves BOTH channels:
//   - PSTN  : `To`/`From` are plain E.164 → SIP user part is the bare number.
//   - WhatsApp: Twilio prefixes `To`/`From` with `whatsapp:` → we re-attach the
//     `whatsapp:` prefix to the SIP user part so LiveKit→worker can detect the
//     channel and pick WhatsApp-specific behaviour. Tenant resolution then
//     matches the prefixed phone_numbers row (see resolveTenantByPhone).
//
// Returns TwiML XML (Content-Type text/xml), status 200.

// Shared LiveKit inbound SIP trunk host. No exported constant exists elsewhere
// in the repo (lib/livekit-sip.ts drives the trunk via the server SDK using
// LIVEKIT_URL + trunk SID, not a SIP host), so it lives here as the single
// source for the dial target. transport=tcp + edge=frankfurt mirror the
// inbound media region used for the Twilio trunk.
const SIP_TRUNK_HOST = "ol4knn33uqv.sip.livekit.cloud";
const SIP_PARAMS = ";transport=tcp;edge=frankfurt";

/**
 * Detect the WhatsApp channel and return the bare E.164 number plus whether the
 * `whatsapp:` prefix was present. Sanitizes to digits and a single leading `+`
 * to prevent TwiML/SIP injection — anything else yields an empty number.
 */
function parseTwilioAddress(raw: string): {
  isWhatsApp: boolean;
  number: string;
} {
  const trimmed = (raw ?? "").trim();
  const isWhatsApp = trimmed.startsWith("whatsapp:");
  const bare = isWhatsApp ? trimmed.slice("whatsapp:".length) : trimmed;
  // Keep only digits and a single leading "+". E.164 is all we ever expect.
  const cleaned = bare.replace(/[^\d+]/g, "");
  const number = cleaned.startsWith("+")
    ? `+${cleaned.slice(1).replace(/\+/g, "")}`
    : cleaned.replace(/\+/g, "");
  return { isWhatsApp, number };
}

export async function POST(req: NextRequest): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const to = form ? String(form.get("To") ?? "") : "";
  const from = form ? String(form.get("From") ?? "") : "";

  // Channel is WhatsApp if either leg carries the whatsapp: prefix. The dialed
  // number drives the SIP user part; the caller leg only informs the channel.
  const calledNumber = parseTwilioAddress(to);
  const caller = parseTwilioAddress(from);
  const isWhatsApp = calledNumber.isWhatsApp || caller.isWhatsApp;

  const prefix = isWhatsApp ? "whatsapp:" : "";
  const sipUri = `sip:${prefix}${calledNumber.number}@${SIP_TRUNK_HOST}${SIP_PARAMS}`;

  const twiml = `<Response><Dial><Sip>${sipUri}</Sip></Dial></Response>`;

  return new Response(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
