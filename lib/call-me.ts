// "Call me" (V7b) — pure rules for the request.

const E164 = /^\+[1-9]\d{7,14}$/;
export const CALL_ME_COOLDOWN_MS = 2 * 60 * 1000;

/** The number to call: the body's, else the owner's WhatsApp; null if none valid. */
export function callMeTarget(bodyPhone: unknown, ownerWhatsapp: string | null | undefined): string | null {
  const raw = typeof bodyPhone === "string" && bodyPhone.trim() ? bodyPhone : (ownerWhatsapp ?? "");
  const v = raw.replace(/[\s()-]/g, "");
  return E164.test(v) ? v : null;
}

/** One call-back per tenant every 2 minutes (it costs a real outbound call). */
export function callMeAllowed(lastStartedAt: Date | null, now = new Date()): boolean {
  return !lastStartedAt || now.getTime() - lastStartedAt.getTime() >= CALL_ME_COOLDOWN_MS;
}
