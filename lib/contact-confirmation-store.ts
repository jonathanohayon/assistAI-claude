// Verified numbers, N1: the DB side of lib/contact-confirmation.ts.
// - contactConfirmationsWrite(): the extra column a config save writes when
//   it changes a contact value (recorded only, nothing enforced);
// - markContactConfirmedByAdmin(): an admin vouches for the CURRENT value
//   of one kind for an account (logged). No route or screen yet (N2);
// - loadEnforcementStartedAt(): the ONE date the grandfather grace runs
//   from (app setting, written by N4/N5 when enforcement is switched on;
//   nothing writes it in N1).
// DB-tested in scripts/tests/contact-confirmation-db.test.ts.

import { eq, sql } from "drizzle-orm";

import {
  confirmationsAfterConfirm,
  confirmationsAfterSave,
  contactValuesOf,
  normaliseContactValue,
  savedContactValues,
  type ContactKind,
} from "@/lib/contact-confirmation";
import { getSetting } from "@/lib/settings";
import { db } from "@/lib/db";
import { agentConfigs } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";

// ::jsonb cast: postgres-js would serialise the object as text otherwise.
const jsonb = (v: unknown) => sql`${JSON.stringify(v)}::jsonb`;

/**
 * `{ contactConfirmations }` to add to an agent_configs UPDATE, or `{}` when
 * the write changes no contact value's record. `current` = the row before
 * the write (its contact columns + contactConfirmations), `updates` = the
 * columns the write sets.
 */
export function contactConfirmationsWrite(
  current: Parameters<typeof savedContactValues>[0] & { contactConfirmations: unknown },
  updates: Parameters<typeof savedContactValues>[1],
  now: Date = new Date(),
): { contactConfirmations?: ReturnType<typeof jsonb> } {
  const next = confirmationsAfterSave(current.contactConfirmations, savedContactValues(current, updates), contactValuesOf(current), now);
  return next ? { contactConfirmations: jsonb(next) } : {};
}

/** app_settings key: ISO date enforcement was switched on. Absent = not started. */
export const CONTACT_CONFIRMATION_ENFORCED_AT_KEY = "contact_confirmation_enforced_at";

/** The enforcement start date, or null (absent or not a date = not started). */
export async function loadEnforcementStartedAt(): Promise<Date | null> {
  const raw = await getSetting(CONTACT_CONFIRMATION_ENFORCED_AT_KEY);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type AdminConfirmResult = { ok: true } | { ok: false; error: "no_config" | "no_value" };

/**
 * Marks the account's CURRENT value of `kind` confirmed, by "admin", and
 * logs it (kind and admin only: never the value). Row-locked so the value
 * confirmed is the value stored.
 */
export async function markContactConfirmedByAdmin(
  userId: string,
  kind: ContactKind,
  adminUserId: string,
  now: Date = new Date(),
): Promise<AdminConfirmResult> {
  const result = await db.transaction(async (tx): Promise<AdminConfirmResult> => {
    const [row] = await tx
      .select({
        ownerWhatsapp: agentConfigs.ownerWhatsapp,
        transferNumber: agentConfigs.transferNumber,
        transferNumberParked: agentConfigs.transferNumberParked,
        ownerRecapEmail: agentConfigs.ownerRecapEmail,
        contactConfirmations: agentConfigs.contactConfirmations,
      })
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, userId))
      .for("update");
    if (!row) return { ok: false, error: "no_config" };
    const value = normaliseContactValue(kind, contactValuesOf(row)[kind]);
    if (value === "") return { ok: false, error: "no_value" };
    const next = confirmationsAfterConfirm(row.contactConfirmations, kind, value, "admin", now);
    // updatedAt untouched: this is not a config change.
    await tx
      .update(agentConfigs)
      .set({ contactConfirmations: jsonb(next) } as never)
      .where(eq(agentConfigs.userId, userId));
    return { ok: true };
  });
  if (result.ok) {
    await logEvent({
      source: "web",
      event: "contact_confirmed_by_admin",
      message: `Admin ${adminUserId} marked ${kind} confirmed for ${userId}`,
      userId: adminUserId,
      metadata: { targetUserId: userId, kind, by: "admin" },
    });
  }
  return result;
}
