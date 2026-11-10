// "Call me" (V7b) — pure rules for the request.

const E164 = /^\+[1-9]\d{7,14}$/;
export const CALL_ME_COOLDOWN_MS = 2 * 60 * 1000;

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/[\s()-]/g, "") : "");

/**
 * The account's own numbers we may dial: the owner's WhatsApp number and the
 * transfer number when set. NEVER a free-form number: otherwise any tenant
 * could make our trunk dial anyone.
 */
export function callMeAllowedTargets(acct: { ownerWhatsapp?: string | null; transferNumber?: string | null }): string[] {
  return [...new Set([clean(acct.ownerWhatsapp), clean(acct.transferNumber)].filter((n) => E164.test(n)))];
}

/**
 * The number to call: the body's when it is one of the account's own
 * numbers, else the owner's WhatsApp; null when none (→ 400 invalid_phone).
 */
export function callMeTarget(
  bodyPhone: unknown,
  acct: { ownerWhatsapp?: string | null; transferNumber?: string | null },
): string | null {
  if (bodyPhone !== undefined && bodyPhone !== null && typeof bodyPhone !== "string") return null;
  const allowed = callMeAllowedTargets(acct);
  const asked = clean(bodyPhone);
  if (asked) return allowed.includes(asked) ? asked : null;
  const owner = clean(acct.ownerWhatsapp);
  return allowed.includes(owner) ? owner : null;
}

/**
 * Server-side switch (env CALL_ME): "off" (default) | "admin" | "all".
 * OFF FOR EVERYONE until the worker's call_me origin (worker #33) is live:
 * the old worker would read a call-me leg as an inbound call. Rollout at the
 * test session: deploy #33 → CALL_ME=admin → Jonathan tests → CALL_ME=all.
 */
export type CallMeMode = "off" | "admin" | "all";

export function callMeMode(env: Record<string, string | undefined> = process.env): CallMeMode {
  const v = (env.CALL_ME ?? "").trim().toLowerCase();
  return v === "admin" || v === "all" ? v : "off";
}

/** null = allowed; otherwise the 403 error code. */
export function callMeAccess(mode: CallMeMode, isAdmin: boolean): null | "call_me_disabled" | "admin_only" {
  if (mode === "off") return "call_me_disabled";
  if (mode === "admin" && !isAdmin) return "admin_only";
  return null;
}

/** One call-back per tenant every 2 minutes (it costs a real outbound call). */
export function callMeAllowed(lastStartedAt: Date | null, now = new Date()): boolean {
  return !lastStartedAt || now.getTime() - lastStartedAt.getTime() >= CALL_ME_COOLDOWN_MS;
}
