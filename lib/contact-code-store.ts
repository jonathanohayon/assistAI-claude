// Verified contacts, N2: the DB side of lib/contact-code.ts (table
// contact_confirmation_codes, migration 0052). Kind-generic.
// - loadContactForCode(): the account's CURRENT value of a kind, its N1
//   record and its locale (the only address a code may go to: the saved one);
// - issueContactCode(): stores the ONE live code (replaces any previous one);
// - dropContactCode(): removes a code that could not be sent;
// - confirmContactCode(): the typed code against the live row, row-locked
//   with the account's config row, so the value confirmed is the value stored
//   and parallel tries cannot exceed the limit. On success the N1 record gets
//   { value, state: "confirmed", at, by: "code" } (confirmationsAfterConfirm).
// Times (expiry) come from the database clock, so all replicas agree.
// DB-tested in scripts/tests/recap-email-code-db.test.ts.

import { and, eq, sql } from "drizzle-orm";

import {
  confirmationsAfterConfirm,
  contactValuesOf,
  normaliseContactValue,
  type ContactKind,
} from "@/lib/contact-confirmation";
import { CODE_TTL_MS, decideConfirm, hashCode, valueKey, type ConfirmError, type StoredCode } from "@/lib/contact-code";
import { db } from "@/lib/db";
import { agentConfigs, contactConfirmationCodes, users } from "@/lib/db/schema";

// ::jsonb cast: postgres-js would serialise the object as text otherwise.
const jsonb = (v: unknown) => sql`${JSON.stringify(v)}::jsonb`;

const contactColumns = {
  ownerWhatsapp: agentConfigs.ownerWhatsapp,
  transferNumber: agentConfigs.transferNumber,
  transferNumberParked: agentConfigs.transferNumberParked,
  ownerRecapEmail: agentConfigs.ownerRecapEmail,
  contactConfirmations: agentConfigs.contactConfirmations,
};

export interface ContactForCode {
  /** The normalised value stored now for the kind ('' = none). */
  value: string;
  /** agent_configs.contact_confirmations (the N1 record). */
  record: unknown;
  /** users.locale of the account. */
  locale: string | null;
}

/** null = the account has no agent config. */
export async function loadContactForCode(userId: string, kind: ContactKind): Promise<ContactForCode | null> {
  const [row] = await db
    .select({ ...contactColumns, locale: users.locale })
    .from(agentConfigs)
    .innerJoin(users, eq(users.id, agentConfigs.userId))
    .where(eq(agentConfigs.userId, userId))
    .limit(1);
  if (!row) return null;
  return {
    value: normaliseContactValue(kind, contactValuesOf(row)[kind]),
    record: row.contactConfirmations,
    locale: row.locale,
  };
}

/** Stores the account's ONE live code for `kind` (any previous one is replaced: new salt, 0 tries, new expiry). */
export async function issueContactCode(input: {
  userId: string;
  kind: ContactKind;
  value: string;
  code: string;
  salt: string;
}): Promise<void> {
  const row = {
    userId: input.userId,
    kind: input.kind,
    valueHash: valueKey(input.kind, input.value),
    salt: input.salt,
    codeHash: hashCode(input),
    attempts: 0,
    expiresAt: sql`clock_timestamp() + ${`${CODE_TTL_MS} milliseconds`}::interval`,
    createdAt: sql`clock_timestamp()`,
  };
  await db
    .insert(contactConfirmationCodes)
    .values(row as never)
    .onConflictDoUpdate({
      target: [contactConfirmationCodes.userId, contactConfirmationCodes.kind],
      set: {
        valueHash: row.valueHash,
        salt: row.salt,
        codeHash: row.codeHash,
        attempts: 0,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      } as never,
    });
}

/** Removes the code issued with `salt` (a later send's code is kept). */
export async function dropContactCode(userId: string, kind: ContactKind, salt: string): Promise<void> {
  await db
    .delete(contactConfirmationCodes)
    .where(
      and(
        eq(contactConfirmationCodes.userId, userId),
        eq(contactConfirmationCodes.kind, kind),
        eq(contactConfirmationCodes.salt, salt),
      ),
    );
}

export type ConfirmCodeResult =
  | { ok: true; at: string }
  | { ok: false; error: ConfirmError | "no_config" | "no_value" };

type Rows = unknown[] | { rows: unknown[] };
const rowsOf = (r: Rows): unknown[] => (Array.isArray(r) ? r : r.rows);

/** The typed (already parsed, 6-digit) code against the account's live code for `kind`. */
export async function confirmContactCode(
  userId: string,
  kind: ContactKind,
  code: string,
  now: Date = new Date(),
): Promise<ConfirmCodeResult> {
  return db.transaction(async (tx): Promise<ConfirmCodeResult> => {
    // Config row first (same lock order as every config write), then the code row.
    const [cfg] = await tx.select(contactColumns).from(agentConfigs).where(eq(agentConfigs.userId, userId)).for("update");
    if (!cfg) return { ok: false, error: "no_config" };
    const currentValue = normaliseContactValue(kind, contactValuesOf(cfg)[kind]);
    if (currentValue === "") return { ok: false, error: "no_value" };
    const [raw] = rowsOf(
      (await tx.execute(sql`
        SELECT value_hash, salt, code_hash, attempts, (expires_at <= clock_timestamp()) AS expired
          FROM contact_confirmation_codes WHERE user_id = ${userId} AND kind = ${kind} FOR UPDATE
      `)) as Rows,
    ) as { value_hash: string; salt: string; code_hash: string; attempts: number; expired: boolean }[];
    const row: StoredCode | null = raw
      ? { valueHash: raw.value_hash, salt: raw.salt, codeHash: raw.code_hash, attempts: Number(raw.attempts), expired: raw.expired === true }
      : null;
    const where = and(eq(contactConfirmationCodes.userId, userId), eq(contactConfirmationCodes.kind, kind));
    const decision = decideConfirm(row, { userId, kind, currentValue, code });
    if (decision.outcome === "refused") {
      if (decision.write === "delete") await tx.delete(contactConfirmationCodes).where(where);
      else if (decision.write !== "none") {
        await tx.update(contactConfirmationCodes).set({ attempts: decision.write.attempts }).where(where);
      }
      return { ok: false, error: decision.error };
    }
    await tx.delete(contactConfirmationCodes).where(where);
    const next = confirmationsAfterConfirm(cfg.contactConfirmations, kind, currentValue, "code", now);
    // updatedAt untouched: this is not a config change.
    await tx
      .update(agentConfigs)
      .set({ contactConfirmations: jsonb(next) } as never)
      .where(eq(agentConfigs.userId, userId));
    return { ok: true, at: now.toISOString() };
  });
}
