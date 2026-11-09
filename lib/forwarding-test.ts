// Call-forwarding setup check — pure helpers. DB side: lib/forwarding-test-db.ts;
// API: /api/dashboard/forwarding-test.
//
// Rule (tamaraAlbert, 2026-11-05): the owner has SOMEONE ELSE call the usual
// business number during a 10-min window. The first inbound call to the
// tenant's number inside the window verifies forwarding ('window'). When the
// call carries a forward header (ForwardedFrom / SIP Diversion) matching the
// business number, the proof is stronger ('diversion'). No caller-ID matching.

import { normalizeClientPhone } from "@/lib/reminders";

export const FORWARDING_TEST_WINDOW_MS = 10 * 60 * 1000;

export type ForwardingStatus = "idle" | "waiting" | "detected" | "expired";
export type ForwardingMethod = "window" | "diversion";

export interface ForwardingState {
  forwardingTestStartedAt: Date | null;
  forwardingDetectedAt: Date | null;
}

export function forwardingStatus(s: ForwardingState, now: Date): ForwardingStatus {
  if (!s.forwardingTestStartedAt) return "idle";
  if (s.forwardingDetectedAt && s.forwardingDetectedAt >= s.forwardingTestStartedAt) return "detected";
  return now.getTime() - s.forwardingTestStartedAt.getTime() <= FORWARDING_TEST_WINDOW_MS
    ? "waiting"
    : "expired";
}

/** Phone typed in the wizard (local 05…/02… or E.164) → E.164, or null. */
export function parsePhone(raw: unknown): string | null {
  return typeof raw === "string" ? normalizeClientPhone(raw) : null;
}

/**
 * 'diversion' when the call says it was forwarded from the business number
 * (or from anywhere, if the owner gave no business number), else 'window'.
 */
export function verificationMethod(
  forwardedFromRaw: string | null | undefined,
  businessPhone: string,
): ForwardingMethod {
  const fwd = forwardedFromRaw ? normalizeClientPhone(forwardedFromRaw.replace(/^(sip:|tel:)/, "").split("@")[0]) : null;
  if (!fwd) return "window";
  return !businessPhone || fwd === businessPhone ? "diversion" : "window";
}
