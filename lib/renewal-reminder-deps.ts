// The real effects of the renewal reminder (lib/renewal-reminder.ts), as ONE
// mutable object so the DB suite can swap the sender (and inject a failure);
// the cron always calls through it, production never reassigns it.
// SERVER-ONLY (lib/db, lib/email).

import { and, eq, gt, lte, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { renewalReminders, users } from "@/lib/db/schema";
import { sendRenewalReminderEmail } from "@/lib/email";
import { logEvent } from "@/lib/logger";
import { paidOrderLines } from "@/lib/order-create";
import { REMINDER_DAYS_BEFORE, publicAppOrigin, type ReminderAccount, type RenewalReminderDeps } from "@/lib/renewal-reminder";

const DAY_MS = 24 * 60 * 60 * 1000;

const accountColumns = {
  id: users.id,
  email: users.email,
  role: users.role,
  locale: users.locale,
  subscriptionStatus: users.subscriptionStatus,
  paidUntil: users.paidUntil,
};

/** Active, not admin, paid_until in (now, now + REMINDER_DAYS_BEFORE days]. */
async function listCandidates(now: Date): Promise<ReminderAccount[]> {
  return db
    .select(accountColumns)
    .from(users)
    .where(
      and(
        eq(users.subscriptionStatus, "active"),
        ne(users.role, "admin"),
        gt(users.paidUntil, now),
        lte(users.paidUntil, new Date(now.getTime() + REMINDER_DAYS_BEFORE * DAY_MS)),
      ),
    );
}

async function reread(userId: string): Promise<ReminderAccount | null> {
  const [row] = await db.select(accountColumns).from(users).where(eq(users.id, userId)).limit(1);
  return row ?? null;
}

async function claim({ userId, periodEnd }: { userId: string; periodEnd: Date }): Promise<boolean> {
  const rows = await db
    .insert(renewalReminders)
    .values({ userId, periodEnd })
    .onConflictDoNothing({ target: [renewalReminders.userId, renewalReminders.periodEnd] })
    .returning({ id: renewalReminders.id });
  return rows.length === 1;
}

export const renewalReminderDeps: RenewalReminderDeps = {
  switchValue: () => process.env.RENEWAL_REMINDER_EMAIL,
  now: () => new Date(),
  origin: () => publicAppOrigin(process.env),
  listCandidates,
  paidOrderLines: (userId) => paidOrderLines(userId),
  reread,
  claim,
  send: sendRenewalReminderEmail,
  logEvent,
};
