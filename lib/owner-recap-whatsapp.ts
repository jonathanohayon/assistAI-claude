// Post-call owner recap by WHATSAPP, sent by /api/calls/end.
//
// The wrapper around the recap ("📞 New call received" heading, the caller
// line, "unknown number") is in the tenant's primary language, with the SAME
// strings as the owner recap email (messages/*.json → Email.ownerRecap:
// `heading`, `unknownNumber`). French is byte-identical to the old hard-coded
// text: "📞 Nouvel appel reçu\n\n<recap>\n\n— <number | numéro inconnu>".
//
// Two delivery paths, both carrying the SAME text:
//   - template: WHATSAPP_OWNER_TEMPLATE_SID_<LANG>, else the legacy
//     WHATSAPP_OWNER_TEMPLATE_SID. The approved template text and SID are
//     never built here: only the {{1}} variable's VALUE (the text below).
//   - free-form: no template SID set → the text is the message Body.
//
// The sender is injectable (`ownerRecapWhatsAppDeps`): tests never reach the
// WhatsApp provider.

import { ltrIsolate } from "./phone-utils";
import type { RecapLocale, RecapStrings } from "./owner-recap-email";
import { sendWhatsApp, type WhatsAppOptions, type WhatsAppResult } from "./whatsapp";

const RECAP_LOCALES: readonly RecapLocale[] = ["fr", "he", "en"];

/** The tenant's primary language → a recap locale; anything else → fr. */
export function toRecapLocale(raw: string | null | undefined): RecapLocale {
  const short = (raw ?? "").toLowerCase().split("-")[0];
  return (RECAP_LOCALES as readonly string[]).includes(short) ? (short as RecapLocale) : "fr";
}

/** The owner WhatsApp recap text: heading, recap, "— <caller>". */
export function ownerRecapWhatsAppText(
  input: { forOwner: string; fromNumber: string | null | undefined },
  t: RecapStrings,
): string {
  // ltrIsolate: the recap may be Hebrew (RTL); keep the "+" in front.
  const caller = input.fromNumber ? ltrIsolate(input.fromNumber) : t("unknownNumber");
  return `${t("heading")}\n\n${input.forOwner}\n\n— ${caller}`;
}

/**
 * The owner template SID for the tenant's language, exactly as before:
 * WHATSAPP_OWNER_TEMPLATE_SID_<LANG> first, then the legacy SID, else none
 * (free-form).
 */
export function ownerRecapTemplateSid(
  primaryLanguage: string | null | undefined,
  env: Record<string, string | undefined>,
): string | undefined {
  const key = `WHATSAPP_OWNER_TEMPLATE_SID_${(primaryLanguage ?? "fr").toUpperCase()}`;
  return env[key] || env.WHATSAPP_OWNER_TEMPLATE_SID || undefined;
}

/** What is handed to the WhatsApp sender for the owner recap. */
export function ownerRecapWhatsAppMessage(
  input: {
    to: string;
    forOwner: string;
    fromNumber: string | null | undefined;
    primaryLanguage: string | null | undefined;
  },
  t: RecapStrings,
  env: Record<string, string | undefined>,
): WhatsAppOptions {
  const body = ownerRecapWhatsAppText(input, t);
  const templateSid = ownerRecapTemplateSid(input.primaryLanguage, env);
  return {
    to: input.to,
    body,
    templateSid,
    templateVariables: templateSid ? { "1": body.slice(0, 1000) } : undefined,
    ownerTemplateFallback: true, // Meta provider only
  };
}

export const ownerRecapWhatsAppDeps = {
  send: sendWhatsApp as (opts: WhatsAppOptions) => Promise<WhatsAppResult>,
};

export async function sendOwnerRecapWhatsApp(
  input: Parameters<typeof ownerRecapWhatsAppMessage>[0],
  t: RecapStrings,
  env: Record<string, string | undefined> = process.env,
): Promise<WhatsAppResult> {
  return ownerRecapWhatsAppDeps.send(ownerRecapWhatsAppMessage(input, t, env));
}
