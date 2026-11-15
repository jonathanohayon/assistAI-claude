// Verified numbers, N1: the confirmation state of every contact value the
// tenant types (agent_configs.contact_confirmations) and the ONE decision
// "may we send to this value", for the screen (N2) and for the senders (N4).
//
// Pure: no database, no env, no I/O. Safe to import anywhere on the server.
// Unit-tested in scripts/tests/contact-confirmation.test.ts; the store side
// (DB writes, the enforcement date) in lib/contact-confirmation-store.ts.
//
// Record shape (jsonb object, keyed by kind):
//   { "owner_whatsapp": { value, state: "confirmed", at, by }, ... }
// - NO ENTRY for a kind = the value is GRANDFATHERED: it was there before
//   this code (or written by a path that doesn't record) and reads
//   CONFIRMED. Migration 0051 writes no data: every existing account has
//   `{}`. Only a NEW value saved by the new code gets an entry.
// - `value` is the NORMALISED value the entry applies to. When the stored
//   value changes, the entry no longer matches and the value reads
//   "unconfirmed" (reason "value_changed"), whatever the entry says.
// - `at` is an ISO timestamp: when it was confirmed, or saved unconfirmed.
// - `by` (confirmed only): "code" (N3) or "admin".
// - A malformed entry (or a column that is not an object) reads unconfirmed.
// - A code is NEVER stored here (N3 keeps its own hashed, expiring codes).
//
// Grace (N5): grandfathered values keep working for
// CONTACT_CONFIRMATION_GRACE_DAYS from ONE date, the day enforcement is
// switched on (app setting, see the store); then they stop receiving.

/**
 * N1: enforcement is OFF. maySendTo() answers `allowed: true` whatever the
 * state, so every send is what it was before. N4 turns it on.
 */
export const CONTACT_CONFIRMATION_ENFORCED = false;

/** Days a grandfathered value keeps receiving once enforcement is on (N5). */
export const CONTACT_CONFIRMATION_GRACE_DAYS = 14;

export const CONTACT_KINDS = ["owner_whatsapp", "transfer_number", "owner_recap_email"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export type ConfirmedBy = "code" | "admin";

export type ConfirmationEntry =
  | { value: string; state: "confirmed"; at: string; by: ConfirmedBy }
  | { value: string; state: "unconfirmed"; at: string };

export type ContactConfirmations = Partial<Record<ContactKind, ConfirmationEntry>>;

export type UnconfirmedReason =
  /** The kind has no value: nothing to send to. */
  | "no_value"
  /** The entry is for another value: the value changed since. */
  | "value_changed"
  /** The value was saved by the new code and never confirmed. */
  | "not_confirmed"
  /** The entry (or the whole column) is not a valid record. */
  | "malformed";

export type ContactState =
  /** No entry for the kind: there before this code. */
  | { state: "confirmed"; source: "grandfathered" }
  | { state: "confirmed"; source: "record"; by: ConfirmedBy; at: string }
  | { state: "unconfirmed"; reason: UnconfirmedReason; at?: string };

export type GraceState =
  /** Grandfathered, enforcement not started: sends as today. */
  | "grandfathered"
  /** Grandfathered, enforcement started < GRACE_DAYS ago: "à confirmer", still sends. */
  | "grace"
  /** Grandfathered, enforcement started ≥ GRACE_DAYS ago: N5 stops sends. */
  | "expired"
  /** The value has an entry (or no value): grace does not apply. */
  | "not_grandfathered";

export type SendDecision = { allowed: boolean; grace: GraceState } & ContactState;

const BY: readonly ConfirmedBy[] = ["code", "admin"];
const DAY_MS = 24 * 3600_000;

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

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function parseEntry(raw: unknown): ConfirmationEntry | null {
  if (!isObject(raw)) return null;
  if (typeof raw.value !== "string" || raw.value === "" || typeof raw.at !== "string") return null;
  if (raw.state === "confirmed") {
    if (!BY.includes(raw.by as ConfirmedBy)) return null;
    return { value: raw.value, state: "confirmed", at: raw.at, by: raw.by as ConfirmedBy };
  }
  if (raw.state === "unconfirmed") return { value: raw.value, state: "unconfirmed", at: raw.at };
  return null;
}

/** The valid entries of the stored column (unknown kinds and malformed entries dropped). */
export function parseContactConfirmations(raw: unknown): ContactConfirmations {
  const out: ContactConfirmations = {};
  if (!isObject(raw)) return out;
  for (const kind of CONTACT_KINDS) {
    const entry = parseEntry(raw[kind]);
    if (entry) out[kind] = entry;
  }
  return out;
}

/** The state of `value` for `kind`, from the stored record (the whole column). */
export function contactState(kind: ContactKind, value: unknown, record: unknown): ContactState {
  const v = normaliseContactValue(kind, value);
  if (v === "") return { state: "unconfirmed", reason: "no_value" };
  // The column is NOT NULL DEFAULT '{}': anything but an object (a caller
  // that didn't select it included) fails closed.
  if (!isObject(record)) return { state: "unconfirmed", reason: "malformed" };
  if (!(kind in record)) return { state: "confirmed", source: "grandfathered" };
  const entry = parseEntry(record[kind]);
  if (!entry) return { state: "unconfirmed", reason: "malformed" };
  if (normaliseContactValue(kind, entry.value) !== v) return { state: "unconfirmed", reason: "value_changed" };
  if (entry.state === "unconfirmed") return { state: "unconfirmed", reason: "not_confirmed", at: entry.at };
  return { state: "confirmed", source: "record", by: entry.by, at: entry.at };
}

/** Where a value stands in the grandfather grace, from ONE date: enforcement's start. */
export function graceFor(state: ContactState, enforcementStartedAt: Date | null, now: Date): GraceState {
  if (!(state.state === "confirmed" && state.source === "grandfathered")) return "not_grandfathered";
  if (!enforcementStartedAt || Number.isNaN(enforcementStartedAt.getTime())) return "grandfathered";
  const elapsed = now.getTime() - enforcementStartedAt.getTime();
  if (elapsed < 0) return "grandfathered";
  return elapsed < CONTACT_CONFIRMATION_GRACE_DAYS * DAY_MS ? "grace" : "expired";
}

/** graceFor() straight from the stored record. */
export function graceState(
  kind: ContactKind,
  value: unknown,
  record: unknown,
  enforcementStartedAt: Date | null,
  now: Date,
): GraceState {
  return graceFor(contactState(kind, value, record), enforcementStartedAt, now);
}

/**
 * THE decision: may a message or call go to `value` (the value about to be
 * used). N1: enforcement is off → `allowed: true` always; the state and the
 * grace are still reported, so the screen can show them while nothing is
 * blocked. Enforced (N4/N5): a confirmed value passes, except a
 * grandfathered one whose grace has expired. `opts` exists for the tests
 * and N4; callers leave it out in N1.
 */
export function maySendTo(
  kind: ContactKind,
  value: unknown,
  record: unknown,
  opts: { enforced?: boolean; enforcementStartedAt?: Date | null; now?: Date } = {},
): SendDecision {
  const s = contactState(kind, value, record);
  const grace = graceFor(s, opts.enforcementStartedAt ?? null, opts.now ?? new Date());
  const enforced = opts.enforced ?? CONTACT_CONFIRMATION_ENFORCED;
  return { allowed: !enforced || (s.state === "confirmed" && grace !== "expired"), grace, ...s };
}

/**
 * The record after a save. `values` = the kinds the save wrote, with their
 * value AFTER it; `before` = their value before it. An omitted kind keeps
 * its value AND its record.
 * - same value as a matching entry → kept;
 * - no entry and the same value as before → kept (still grandfathered);
 * - a new value → `unconfirmed` for that value, `at` = now;
 * - an empty value → the entry is removed.
 * `null` when nothing changes (no column write). A stored column that is not
 * an object is left as it is (it reads unconfirmed for every kind).
 */
export function confirmationsAfterSave(
  record: unknown,
  values: Partial<Record<ContactKind, string>>,
  before: Partial<Record<ContactKind, string>>,
  now: Date,
): Record<string, unknown> | null {
  if (!isObject(record)) return null;
  const next: Record<string, unknown> = { ...record };
  let changed = false;
  for (const kind of CONTACT_KINDS) {
    if (!(kind in values)) continue;
    const v = normaliseContactValue(kind, values[kind]);
    if (v === "") {
      if (kind in next) {
        delete next[kind];
        changed = true;
      }
      continue;
    }
    const entry = parseEntry(record[kind]);
    if (entry && normaliseContactValue(kind, entry.value) === v) continue;
    if (!(kind in record) && normaliseContactValue(kind, before[kind]) === v) continue;
    next[kind] = { value: v, state: "unconfirmed", at: now.toISOString() };
    changed = true;
  }
  return changed ? next : null;
}

/** The record with `kind` confirmed for `value` (admin, or a code in N3). */
export function confirmationsAfterConfirm(
  record: unknown,
  kind: ContactKind,
  value: string,
  by: ConfirmedBy,
  now: Date,
): Record<string, unknown> {
  return {
    ...(isObject(record) ? record : {}),
    [kind]: { value: normaliseContactValue(kind, value), state: "confirmed", at: now.toISOString(), by },
  };
}

type ContactColumns = {
  ownerWhatsapp: string;
  transferNumber: string;
  transferNumberParked: string | null;
  ownerRecapEmail: string;
};

/**
 * The value of each kind on an agent_configs row (missing columns read '').
 * transfer_number is the KEPT number (served, or parked while the Tools
 * transfer switch is OFF), so turning the switch off and on keeps its state.
 */
export function contactValuesOf(row: Partial<ContactColumns>): Record<ContactKind, string> {
  return {
    owner_whatsapp: row.ownerWhatsapp ?? "",
    transfer_number: row.transferNumber || row.transferNumberParked || "",
    owner_recap_email: row.ownerRecapEmail ?? "",
  };
}

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
