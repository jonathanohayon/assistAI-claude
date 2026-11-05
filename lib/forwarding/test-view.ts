// Call-forwarding wizard: client view of the forwarding test
// (POST/GET /api/dashboard/forwarding-test). Pure, client-safe.
// Unit-tested in scripts/tests/forwarding-wizard.test.ts.

export type ForwardingTestStatus = "idle" | "waiting" | "detected" | "expired";

export interface ForwardingTest {
  status: ForwardingTestStatus;
  startedAt: string | null;
  expiresAt: string | null;
  detectedAt: string | null;
  /** Persists after the window: forwarding was verified once. */
  verifiedAt: string | null;
  tenantNumber: string | null;
  ownerPhone: string | null;
}

export type ForwardingTestError = "no_owner_phone" | "invalid_owner_phone" | "no_tenant_number";

/** Seconds left in the test window (0 when over or unknown). */
export function secondsLeft(test: Pick<ForwardingTest, "expiresAt">, now: Date): number {
  if (!test.expiresAt) return 0;
  return Math.max(0, Math.ceil((Date.parse(test.expiresAt) - now.getTime()) / 1000));
}

/**
 * Status to display: a "waiting" test whose window has passed client-side is
 * shown as expired right away (the server agrees on its next poll).
 */
export function displayStatus(test: ForwardingTest, now: Date): ForwardingTestStatus {
  if (test.status === "waiting" && test.expiresAt && secondsLeft(test, now) === 0) return "expired";
  return test.status;
}

/** Poll only while a test is running. */
export function shouldPoll(test: ForwardingTest | null, now: Date): boolean {
  return !!test && displayStatus(test, now) === "waiting";
}

/** "+972500000000" → "050-000-0000" style local display for Israeli numbers. */
export function toIsraeliLocal(e164: string): string {
  const m = /^\+972(\d{8,9})$/.exec(e164);
  if (!m) return e164;
  const local = `0${m[1]}`;
  return local.length === 10
    ? `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`
    : `${local.slice(0, 2)}-${local.slice(2, 5)}-${local.slice(5)}`;
}

/** "m:ss" countdown. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** tel: URI for a USSD/star code: "#" must be percent-encoded or dialers drop it. */
export function telHref(code: string): string {
  return `tel:${code.replace(/#/g, "%23")}`;
}
