// Verified numbers, N1: the confirmation state of every contact value the
// tenant types (agent_configs.contact_confirmations) and the ONE decision
// "may we send to this value", for the screen (N2) and for the senders (N4).
//
// Pure: no database, no env, no I/O. Safe to import anywhere on the server.
// Unit-tested in scripts/tests/contact-confirmation.test.ts; the store side
// (DB writes) in lib/contact-confirmation-store.ts.
//
// Record shape (jsonb, keyed by kind; a kind with no value has no key):
//   { "owner_whatsapp": { value, state: "confirmed", at, by }, ... }
// - `value` is the NORMALISED value the state applies to. When the stored
//   value changes, the old record no longer matches and the value reads
//   "unconfirmed" (reason "value_changed"), whatever the record says.
// - `at` is an ISO timestamp: when it was confirmed, or saved unconfirmed.
// - `by` (confirmed only): "grandfathered" (already set when migration 0051
//   ran: N5's grace counts from its `at`), "code" (N3), "admin".
// - A code is NEVER stored here (N3 keeps its own hashed, expiring codes).

/**
 * N1: enforcement is OFF. maySendTo() answers `allowed: true` whatever the
 * state, so every send is what it was before. N4 turns it on.
 */
export const CONTACT_CONFIRMATION_ENFORCED = false;

export const CONTACT_KINDS = ["owner_whatsapp", "transfer_number", "owner_recap_email"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export type ConfirmedBy = "grandfathered" | "code" | "admin";

export type ConfirmationEntry =
  | { value: string; state: "confirmed"; at: string; by: ConfirmedBy }
  | { value: string; state: "unconfirmed"; at: string };

export type ContactConfirmations = Partial<Record<ContactKind, ConfirmationEntry>>;

export type UnconfirmedReason =
  /** The kind has no value: nothing to send to. */
  | "no_value"
  /** A value with no record (written by a path that does not record). */
  | "no_record"
  /** The record is for another value: the value changed since. */
  | "value_changed"
  /** The value was saved and never confirmed. */
  | "not_confirmed";

export type ContactState =
  | { state: "confirmed"; by: ConfirmedBy; at: string }
  | { state: "unconfirmed"; reason: UnconfirmedReason; at?: string };

export type SendDecision = { allowed: boolean } & ContactState;

const BY: readonly ConfirmedBy[] = ["grandfathered", "code", "admin"];

/**
 * The comparable form of a value. Phones: spaces, dashes, dots, parentheses
 * removed, a leading "+" ensured (the writers already store E.164).
 * Emails: trimmed, lowercased (as lib/owner-recap-email.ts stores them).
 * '' stays ''.
 */
export function normaliseContactValue(kind: ContactKind, raw: unknown): string {
  if (typeof raw !== "string") return "";
  if (kind === "owner_recap_email") return raw.trim().toLowerCase();
  const cleaned = raw.replace(/[\s().-]/g, "");
  if (cleaned === "") return "";
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

function parseEntry(raw: unknown): ConfirmationEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.value !== "string" || e.value === "" || typeof e.at !== "string") return null;
  if (e.state === "confirmed") {
    if (!BY.includes(e.by as ConfirmedBy)) return null;
    return { value: e.value, state: "confirmed", at: e.at, by: e.by as ConfirmedBy };
  }
  if (e.state === "unconfirmed") return { value: e.value, state: "unconfirmed", at: e.at };
  return null;
}

/**
 * The stored column, read defensively: unknown kinds and malformed entries
 * are dropped (a dropped entry reads "no_record" = unconfirmed, never
 * confirmed).
 */
export function parseContactConfirmations(raw: unknown): ContactConfirmations {
  const out: ContactConfirmations = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const kind of CONTACT_KINDS) {
    const entry = parseEntry((raw as Record<string, unknown>)[kind]);
    if (entry) out[kind] = entry;
  }
  return out;
}

/** The state of `value` for `kind`, from the stored record. */
export function contactState(kind: ContactKind, value: unknown, record: unknown): ContactState {
  const v = normaliseContactValue(kind, value);
  if (v === "") return { state: "unconfirmed", reason: "no_value" };
  const entry = parseContactConfirmations(record)[kind];
  if (!entry) return { state: "unconfirmed", reason: "no_record" };
  if (normaliseContactValue(kind, entry.value) !== v) return { state: "unconfirmed", reason: "value_changed" };
  if (entry.state === "unconfirmed") return { state: "unconfirmed", reason: "not_confirmed", at: entry.at };
  return { state: "confirmed", by: entry.by, at: entry.at };
}

/**
 * THE decision: may a message or call go to `value` (the value about to be
 * used, not the one in the record). `allowed` is true when enforcement is
 * off (N1) or the value is confirmed. The state is always reported, so the
 * screen can show it while nothing is blocked. `opts.enforced` exists for
 * the tests and N4; callers leave it out.
 */
export function maySendTo(
  kind: ContactKind,
  value: unknown,
  record: unknown,
  opts: { enforced?: boolean } = {},
): SendDecision {
  const s = contactState(kind, value, record);
  const enforced = opts.enforced ?? CONTACT_CONFIRMATION_ENFORCED;
  return { allowed: !enforced || s.state === "confirmed", ...s };
}

/**
 * The record after a save that wrote `values` (only the kinds the save
 * wrote: an omitted kind keeps its value AND its record).
 * - same normalised value as the record → the entry is kept as it is;
 * - a new value → `unconfirmed` for that value, `at` = now;
 * - an empty value → the entry is removed.
 * `null` when nothing changes (no column write needed).
 */
export function confirmationsAfterSave(
  record: unknown,
  values: Partial<Record<ContactKind, string>>,
  now: Date,
): ContactConfirmations | null {
  const current = parseContactConfirmations(record);
  const next: ContactConfirmations = { ...current };
  let changed = false;
  for (const kind of CONTACT_KINDS) {
    if (!(kind in values)) continue;
    const v = normaliseContactValue(kind, values[kind]);
    const entry = current[kind];
    if (v === "") {
      if (entry) {
        delete next[kind];
        changed = true;
      }
      continue;
    }
    if (entry && normaliseContactValue(kind, entry.value) === v) continue;
    next[kind] = { value: v, state: "unconfirmed", at: now.toISOString() };
    changed = true;
  }
  // A malformed stored column is rewritten clean when anything changes.
  return changed ? next : null;
}

/** The record with `kind` confirmed for `value` (admin or code). */
export function confirmationsAfterConfirm(
  record: unknown,
  kind: ContactKind,
  value: string,
  by: Exclude<ConfirmedBy, "grandfathered">,
  now: Date,
): ContactConfirmations {
  return {
    ...parseContactConfirmations(record),
    [kind]: { value: normaliseContactValue(kind, value), state: "confirmed", at: now.toISOString(), by },
  };
}

/**
 * The value of each kind as stored on an agent_configs row. transfer_number
 * is the KEPT number (served, or parked while the Tools transfer switch is
 * OFF), so turning the switch off and on keeps its confirmation.
 */
export function contactValuesOf(row: {
  ownerWhatsapp: string;
  transferNumber: string;
  transferNumberParked: string | null;
  ownerRecapEmail: string;
}): Record<ContactKind, string> {
  return {
    owner_whatsapp: row.ownerWhatsapp,
    transfer_number: row.transferNumber || row.transferNumberParked || "",
    owner_recap_email: row.ownerRecapEmail,
  };
}

type ContactColumns = {
  ownerWhatsapp: string;
  transferNumber: string;
  transferNumberParked: string | null;
  ownerRecapEmail: string;
};

/**
 * The kinds an agent_configs write touches, with their value AFTER the
 * write: `current` is the row before, `updates` the columns written (a
 * column absent or undefined in `updates` is not written). A kind none of
 * whose columns is written is left out, so its record is kept.
 */
export function savedContactValues(
  current: Partial<ContactColumns>,
  updates: Partial<Record<keyof ContactColumns, unknown>>,
): Partial<Record<ContactKind, string>> {
  const written = (k: keyof ContactColumns) => k in updates && updates[k] !== undefined;
  const after = (k: keyof ContactColumns): string => {
    const v = written(k) ? updates[k] : current[k];
    return typeof v === "string" ? v : "";
  };
  const out: Partial<Record<ContactKind, string>> = {};
  if (written("ownerWhatsapp")) out.owner_whatsapp = after("ownerWhatsapp");
  if (written("transferNumber") || written("transferNumberParked")) {
    out.transfer_number = after("transferNumber") || after("transferNumberParked");
  }
  if (written("ownerRecapEmail")) out.owner_recap_email = after("ownerRecapEmail");
  return out;
}

/** A config row (or route body built from one) without the record. */
export function withoutContactConfirmations<T extends Record<string, unknown>>(row: T): Omit<T, "contactConfirmations"> {
  const { contactConfirmations: _c, ...rest } = row;
  void _c;
  return rest;
}
