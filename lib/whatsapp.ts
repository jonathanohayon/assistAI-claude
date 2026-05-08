// WhatsApp dispatch — supports two providers behind a unified API.
//
// Pick via env: WHATSAPP_PROVIDER=meta (default) or twilio
//
// ── Meta Cloud API (recommandé production) ───────────────────────────────
//   WHATSAPP_PROVIDER=meta
//   WHATSAPP_PHONE_NUMBER_ID   — l'ID du numéro WABA (Meta Business Manager)
//   WHATSAPP_ACCESS_TOKEN      — System User token permanent (graph.facebook.com)
//   WHATSAPP_API_VERSION       — optionnel, default v22.0
//
// ── Twilio Programmable Messaging (fallback / sandbox) ───────────────────
//   WHATSAPP_PROVIDER=twilio
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_WHATSAPP_FROM       — "whatsapp:+14155238886" (sandbox) ou ton sender prod
//
// Outbound rules (Meta) :
//   - "Service window" 24h après le dernier message client → free-form text OK
//   - Hors fenêtre → message template pré-approuvé requis
//   Notre cas: la cliente vient de raccrocher → on est dans la fenêtre. Pour
//   le proprio, idem si historique récent. Sinon, fallback template via
//   WHATSAPP_OWNER_TEMPLATE_NAME (optionnel).

export interface WhatsAppResult {
  ok: boolean;
  sid?: string;
  error?: string;
}

const META_API = "https://graph.facebook.com";

const normalizeE164 = (number: string): string => {
  const trimmed = number.trim();
  const stripped = trimmed.replace(/^whatsapp:/, "").replace(/[\s()-]/g, "");
  return stripped.startsWith("+") ? stripped : `+${stripped}`;
};

// Meta accepts the number without leading "+", per their docs.
const metaNumber = (e164: string): string => e164.replace(/^\+/, "");

// Twilio accepts E.164 prefixed with "whatsapp:".
const twilioNumber = (e164: string): string => `whatsapp:${e164}`;

export async function sendWhatsApp(opts: {
  to: string;
  body: string;
  /** Pour le proprio: nom de template Meta à utiliser hors fenêtre 24h. */
  ownerTemplateFallback?: boolean;
}): Promise<WhatsAppResult> {
  const provider = (process.env.WHATSAPP_PROVIDER ?? "meta").toLowerCase();
  const e164 = normalizeE164(opts.to);

  if (provider === "twilio") {
    return sendViaTwilio(e164, opts.body);
  }
  return sendViaMeta(e164, opts.body, opts.ownerTemplateFallback ?? false);
}

// ── Meta Cloud API ──────────────────────────────────────────────────────

async function sendViaMeta(
  e164: string,
  body: string,
  ownerTemplateFallback: boolean,
): Promise<WhatsAppResult> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const version = process.env.WHATSAPP_API_VERSION ?? "v22.0";

  if (!phoneId || !token) {
    return {
      ok: false,
      error:
        "Meta WhatsApp non configuré (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN manquant)",
    };
  }

  const url = `${META_API}/${version}/${phoneId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: metaNumber(e164),
    type: "text",
    text: { preview_url: false, body },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errBody = await res.text();
    // Outside 24h service window → 131047 / 131056 / 131026. Try template.
    const isWindowError = /131047|131056|131026|service window/i.test(errBody);
    if (isWindowError && ownerTemplateFallback) {
      return sendOwnerTemplate(e164, body);
    }
    return { ok: false, error: `${res.status}: ${errBody.slice(0, 300)}` };
  }

  const data = (await res.json()) as {
    messages?: Array<{ id?: string }>;
  };
  return { ok: true, sid: data.messages?.[0]?.id };
}

// Fallback: if the owner hasn't messaged us in 24h, free-form fails. Use a
// pre-approved utility template named WHATSAPP_OWNER_TEMPLATE_NAME with one
// {{1}} body parameter that we fill with the recap.
async function sendOwnerTemplate(
  e164: string,
  body: string,
): Promise<WhatsAppResult> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
  const token = process.env.WHATSAPP_ACCESS_TOKEN!;
  const version = process.env.WHATSAPP_API_VERSION ?? "v22.0";
  const tplName = process.env.WHATSAPP_OWNER_TEMPLATE_NAME;
  const tplLang = process.env.WHATSAPP_OWNER_TEMPLATE_LANG ?? "fr";

  if (!tplName) {
    return {
      ok: false,
      error:
        "Hors fenêtre 24h et WHATSAPP_OWNER_TEMPLATE_NAME non configuré (template Meta requis)",
    };
  }

  const url = `${META_API}/${version}/${phoneId}/messages`;
  // Meta WhatsApp limits body params to 1024 chars; truncate safely.
  const truncated = body.length > 1024 ? body.slice(0, 1020) + "…" : body;
  const payload = {
    messaging_product: "whatsapp",
    to: metaNumber(e164),
    type: "template",
    template: {
      name: tplName,
      language: { code: tplLang },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: truncated }],
        },
      ],
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    return { ok: false, error: `template ${res.status}: ${err.slice(0, 300)}` };
  }
  const data = (await res.json()) as {
    messages?: Array<{ id?: string }>;
  };
  return { ok: true, sid: data.messages?.[0]?.id };
}

// ── Twilio (sandbox / legacy) ──────────────────────────────────────────

async function sendViaTwilio(
  e164: string,
  body: string,
): Promise<WhatsAppResult> {
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

  const fromNormalized = from.startsWith("whatsapp:")
    ? from
    : twilioNumber(normalizeE164(from));

  const params = new URLSearchParams({
    To: twilioNumber(e164),
    From: fromNormalized,
    Body: body,
  });

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
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
