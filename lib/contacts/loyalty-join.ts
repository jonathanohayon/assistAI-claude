// Contacts view × loyalty (GET /api/dashboard/client-visits): the Sheet stores
// phones in local Israeli format ("05…"), visits are keyed by E.164. Join
// helpers, client-safe. Unit-tested in scripts/tests/loyalty-join.test.ts.

export interface ClientVisits {
  phone: string; // E.164
  name: string;
  visits: number;
  lastVisitAt: string | null;
  nextVisitAt: string | null;
  regular: boolean;
}

/**
 * Normalises a Sheet phone to E.164 for the join. Israeli local numbers
 * ("050-000-0000") get +972 without the trunk 0; "00…" and "972…" are
 * international. Returns "" when it can't tell (no match, never a guess).
 */
export function sheetPhoneToE164(raw: string): string {
  const c = (raw ?? "").replace(/[\s().-]/g, "");
  if (/^\+[1-9]\d{6,14}$/.test(c)) return c;
  if (/^00[1-9]\d{6,14}$/.test(c)) return `+${c.slice(2)}`;
  if (/^972[1-9]\d{7,9}$/.test(c)) return `+${c}`;
  if (/^0[1-9]\d{7,9}$/.test(c)) return `+972${c.slice(1)}`;
  return "";
}

/** Index of visits by E.164 phone. */
export function visitsByPhone(clients: ClientVisits[]): Map<string, ClientVisits> {
  const m = new Map<string, ClientVisits>();
  for (const c of clients) {
    const k = sheetPhoneToE164(c.phone);
    if (k && !m.has(k)) m.set(k, c);
  }
  return m;
}

export function visitsFor(
  index: Map<string, ClientVisits>,
  sheetPhone: string,
): ClientVisits | null {
  const k = sheetPhoneToE164(sheetPhone);
  return k ? (index.get(k) ?? null) : null;
}
