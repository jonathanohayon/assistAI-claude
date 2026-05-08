// Twilio WhatsApp helper. Uses the Programmable Messaging API.
//
// Required env vars:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_WHATSAPP_FROM   — sender, format "whatsapp:+14155238886"
//                            (sandbox or approved business sender)
//
// Numbers are normalized to E.164 then prefixed with `whatsapp:` automatically.

const TWILIO_API = "https://api.twilio.com/2010-04-01";

export interface WhatsAppResult {
  ok: boolean;
  sid?: string;
  error?: string;
}

const normalize = (number: string): string => {
  const trimmed = number.trim();
  if (trimmed.startsWith("whatsapp:")) return trimmed;
  // Strip spaces, dashes, parentheses
  const cleaned = trimmed.replace(/[\s()-]/g, "");
  // Must start with +; if not but starts with digits, prefix +
  const e164 = cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
  return `whatsapp:${e164}`;
};

export async function sendWhatsApp(opts: {
  to: string;
  body: string;
}): Promise<WhatsAppResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;

  if (!accountSid || !authToken || !from) {
    return {
      ok: false,
      error:
        "Twilio WhatsApp non configuré (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM manquant)",
    };
  }

  const to = normalize(opts.to);
  const fromNormalized = from.startsWith("whatsapp:")
    ? from
    : normalize(from);

  const params = new URLSearchParams({
    To: to,
    From: fromNormalized,
    Body: opts.body,
  });

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const res = await fetch(
    `${TWILIO_API}/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    return { ok: false, error: `${res.status}: ${errBody.slice(0, 300)}` };
  }

  const data = (await res.json()) as { sid?: string };
  return { ok: true, sid: data.sid };
}
