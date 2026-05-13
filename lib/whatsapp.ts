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

export interface WhatsAppOptions {
  to: string;
  body: string;
  /** For Meta provider: fall back to a pre-approved template outside the 24h window. */
  ownerTemplateFallback?: boolean;
  /**
   * Twilio Content Template SID (HX...) to send via instead of free-form.
   * Templates bypass the 24h window — use this for client-facing messages.
   * The body string is passed as the {{1}} variable.
   */
  templateSid?: string;
  /** Optional override for template variables. Defaults to {"1": body}. */
  templateVariables?: Record<string, string>;
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

export async function sendWhatsApp(opts: WhatsAppOptions): Promise<WhatsAppResult> {
  const provider = (process.env.WHATSAPP_PROVIDER ?? "meta").toLowerCase();
  const e164 = normalizeE164(opts.to);

  if (provider === "twilio") {
    return sendViaTwilio(e164, opts);
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
  opts: WhatsAppOptions,
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

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  // ── Path 1: pre-approved Content Template (bypasses 24h window) ────────
  // Use this for client-facing messages where the customer hasn't initiated
  // a WhatsApp conversation yet. Twilio Content templates are pre-approved
  // by Meta so they ship anywhere.
  if (opts.templateSid) {
    // Meta WhatsApp interdit newlines/tabs DANS les variables (le template
    // body en a, pas de souci, mais les substitutions {{1}} ne doivent pas
    // contenir de saut de ligne). Sans cette sanitization on tombe sur
    // 21656 "ContentVariables invalid" pour tout summary multi-paragraphe.
    // On normalise aussi les espaces multiples consécutifs pour éviter
    // des artefacts visuels après collapse.
    const sanitize = (v: string): string =>
      v
        .replace(/\r\n?/g, "\n")
        .replace(/\n+/g, " · ")
        .replace(/\t/g, " ")
        .replace(/ {2,}/g, " ")
        .trim()
        .slice(0, 1024);
    const rawVariables =
      opts.templateVariables ?? { "1": opts.body.slice(0, 1024) };
    const variables = Object.fromEntries(
      Object.entries(rawVariables).map(([k, v]) => [k, sanitize(String(v))]),
    );
    const params = new URLSearchParams({
      To: twilioNumber(e164),
      From: fromNormalized,
      ContentSid: opts.templateSid,
      ContentVariables: JSON.stringify(variables),
    });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const errBody = await res.text();
      // Twilio code 21656 = "Content Variables parameter is invalid".
      // Le template configuré attend des noms de variables différents
      // de ce qu'on envoie OU le ContentSid n'existe plus. On essaie
      // un fallback free-form text — marche dans la fenêtre 24h, et
      // c'est mieux que rien (la cliente reçoit le récap de l'appel
      // qu'elle vient de faire, donc la fenêtre est très probablement
      // ouverte si elle nous a déjà WhatsAppé).
      const isTemplateInvalid = /21656|ContentSid|Content Variables/i.test(errBody);
      if (!isTemplateInvalid) {
        return {
          ok: false,
          error: `template ${res.status}: ${errBody.slice(0, 300)}`,
        };
      }
      console.warn(
        '[whatsapp] template invalid (21656), falling back to free-form text',
      );
      // Fall through au path free-form ci-dessous
    } else {
      const data = (await res.json()) as { sid?: string };
      return { ok: true, sid: data.sid };
    }
  }

  // ── Path 2: free-form text (only works inside 24h window) ──────────────
  const params = new URLSearchParams({
    To: twilioNumber(e164),
    From: fromNormalized,
    Body: opts.body,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const errBody = await res.text();
    return { ok: false, error: `${res.status}: ${errBody.slice(0, 300)}` };
  }

  const data = (await res.json()) as { sid?: string };
  return { ok: true, sid: data.sid };
}

/**
 * Vérifie le status d'un message Twilio quelques secondes après l'envoi.
 * L'API initiale renvoie 201 OK ("accepté pour livraison") mais Twilio peut
 * ensuite bloquer la livraison (window 24h, sender pas approuvé, etc.) en
 * mettant le status à "undelivered" / "failed". Sans ce check, on log
 * "envoyé" à tort.
 *
 * À utiliser en best-effort post-send : await new Promise(r => setTimeout(r, 5000))
 * puis appeler cette fonction et re-logger si status problématique.
 */
export async function checkTwilioMessageStatus(sid: string): Promise<{
  status: string;
  errorCode: number | null;
  errorMessage: string | null;
} | null> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken || !sid) return null;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${sid}.json`,
      {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status?: string;
      error_code?: number | null;
      error_message?: string | null;
    };
    return {
      status: data.status ?? "unknown",
      errorCode: data.error_code ?? null,
      errorMessage: data.error_message ?? null,
    };
  } catch {
    return null;
  }
}
