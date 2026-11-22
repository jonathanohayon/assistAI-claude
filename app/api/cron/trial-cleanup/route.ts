import { and, eq, gt, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { calls, paymentOrders, phoneNumbers, users } from "@/lib/db/schema";
import { signupTrialSecondsUsed } from "@/lib/agent/session-config/trial-gate";
import { logEvent } from "@/lib/logger";
import {
  isTrialNumberReleaseDue,
  isTrialPauseDue,
  TRIAL_NUMBER_RELEASE_AFTER_MS,
  TRIAL_PAUSED_STATUS,
  TRIAL_SECONDS_LIMIT,
  TRIAL_WARNING_BEFORE_END_MS,
  trialExhaustionCause,
} from "@/lib/trial";
import { trialCleanupDeps } from "@/lib/trial-cleanup-deps";
import {
  mayEmailTrialAccount,
  parseTrialEndEmailSwitch,
  sendErrorClass,
  trialWarningDays,
} from "@/lib/trial-end-email";

// Cron : gère la fin de free trial pour tous les tenants en `trialing`.
//
// 2026-11 (14 days / 100 min, pause instead of delete):
//   1) Warning: trial_ends_at within 2 days, not yet ended and not yet
//      warned -> email with the REAL whole days left (0/1/2, local days in
//      Asia/Jerusalem, lib/trial-end-email.ts trialWarningDays), stamp
//      trial_warning_sent_at (idempotent). No switch.
//   2) Pause: trial_ends_at passed -> subscription_status = trial_paused.
//      NEVER deleted: data and number kept, calls refused until payment.
//      With TRIAL_END_EMAIL=on (off by default, lib/trial-end-email.ts):
//        - a trialing account whose all-time trial minutes are used up
//          (signupTrialSecondsUsed, the gate's count) is paused too, and its
//          trial_ends_at is set to the pause time (the trial ended then);
//        - every account that flips to trial_paused gets the "Tamara is
//          paused" e-mail ONCE: the conditional UPDATE ... WHERE status =
//          'trialing' RETURNING is the claim, so a re-run or a concurrent
//          run never sends twice. Sent after the flip; a failure is logged
//          (error class only), never retried, never reverts the pause.
//      With it off: exactly the previous behaviour (no minutes pause, no
//      e-mail).
//   3) Number release: 30 days after trial_ends_at (= the pause: the end of
//      the 14 days, or the minutes pause, which moves trial_ends_at to it)
//      -> Twilio number(s) released and unmapped; the account stays.
// Admins and tenants with a HYP payment in progress are skipped. No trial
// e-mail (warning or paused) ever goes to an account with a PAID payment
// order: excluded in the selection and re-checked right before the send.
// Auth : INTERNAL_SECRET via header x-internal-secret (Railway scheduler).

export async function GET(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;

  const startedAt = Date.now();
  const now = new Date();
  const trialEndEmail = parseTrialEndEmailSwitch(process.env.TRIAL_END_EMAIL);
  const warningCutoff = new Date(now.getTime() + TRIAL_WARNING_BEFORE_END_MS);

  // ─── Phase 1 : warnings ─────────────────────────────────────────────
  // Sélectionne les trialing dont trial_ends_at est dans la fenêtre
  // [now, now+2h] et qui n'ont pas encore été warned. Le lt(trialEndsAt,
  // warningCutoff) couvre aussi les users déjà expirés mais pas encore
  // supprimés — on leur envoie quand même un warning juste avant la
  // suppression Phase 2 (cas du tout premier tick après expiration).
  // 2026-11: an ended trial is no longer warned (gt now): the paused e-mail
  // covers it. Never an account with a paid order.
  const toWarn = await db
    .select({
      id: users.id,
      email: users.email,
      trialEndsAt: users.trialEndsAt,
      locale: users.locale,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.subscriptionStatus, "trialing"),
        isNotNull(users.trialEndsAt),
        lt(users.trialEndsAt, warningCutoff),
        gt(users.trialEndsAt, now),
        isNull(users.trialWarningSentAt),
        sql`not ${hasPaidOrderSql}`,
      ),
    );

  const warned: Array<{ email: string; ok: boolean; reason?: string }> = [];
  for (const u of toWarn) {
    const warningDays = u.trialEndsAt ? trialWarningDays(u.trialEndsAt, now) : null;
    if (warningDays === null) continue; // ended meanwhile: the paused e-mail covers it
    // With the switch on, minutes used up = the trial ends now: Phase 2
    // pauses it and sends the paused e-mail instead.
    if (trialEndEmail === "on" && (await signupTrialSecondsUsed(u.id)) >= TRIAL_SECONDS_LIMIT) continue;
    if (!mayEmailTrialAccount({ hasPaidOrder: await hasPaidOrder(u.id), role: u.role })) continue;
    // Récupère un numéro associé pour le mettre dans l'email (best-effort).
    const [pn] = await db
      .select({ phoneNumber: phoneNumbers.phoneNumber })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.userId, u.id))
      .limit(1);

    const minutesLeft = u.trialEndsAt
      ? Math.max(0, Math.round((u.trialEndsAt.getTime() - now.getTime()) / 60000))
      : 0;
    const res = await trialCleanupDeps.sendWarning(u.email, {
      phoneNumber: pn?.phoneNumber ?? null,
      minutesLeft,
      locale: u.locale,
      warningDays,
    });

    if (res.ok) {
      // Stamp même en fallback console_log : on n'a aucun moyen de savoir
      // si Resend manque vraiment ou si c'est un test — mieux vaut ne
      // pas spammer (le warning ne se redéclenchera plus de toute façon).
      await db
        .update(users)
        .set({ trialWarningSentAt: now })
        .where(eq(users.id, u.id));
      warned.push({ email: u.email, ok: true });
      await logEvent({
        source: "auth",
        event: "trial_warning_sent",
        message: `Trial warning envoyé à ${u.id} (expire dans ${minutesLeft} min)`,
        userId: u.id,
        metadata: { minutesLeft, warningDays, tenantLine: pn?.phoneNumber ?? null, emailId: res.id },
      });
    } else {
      warned.push({ email: u.email, ok: false, reason: res.error });
      await logEvent({
        source: "auth",
        event: "trial_warning_failed",
        message: `Échec envoi warning trial à ${u.id} : ${res.error?.slice(0, 200) ?? "?"}`,
        level: "error",
        userId: u.id,
        metadata: { error: res.error },
      });
    }
  }

  // ─── Phase 2 : pause (never delete) ──────────────────────────────────
  // 2026-11: an ended trial is PAUSED. Data and number are kept; calls are
  // refused (isTrialExhausted -> /api/agent/config 403 trial_exhausted). The
  // customer can pay any time and the same agent comes back.
  const toPause = await db
    .select({ id: users.id, email: users.email, role: users.role, trialEndsAt: users.trialEndsAt, subscriptionStatus: users.subscriptionStatus })
    .from(users)
    .where(
      and(
        eq(users.subscriptionStatus, "trialing"),
        isNotNull(users.trialEndsAt),
        lte(users.trialEndsAt, now),
        // A HYP payment in progress: never pause a tenant that is paying.
        or(isNull(users.deletionLockedUntil), lte(users.deletionLockedUntil, now)),
      ),
    );
  const paused: string[] = [];
  const pausedEmailed: string[] = [];
  let pausedForMinutesCount = 0;
  for (const u of toPause) {
    if (!isTrialPauseDue({ ...u, now })) continue; // admins, re-checked in code
    if (trialEndEmail !== "on") {
      // Switch off: the previous behaviour, byte for byte.
      await db
        .update(users)
        .set({ subscriptionStatus: TRIAL_PAUSED_STATUS })
        .where(and(eq(users.id, u.id), eq(users.subscriptionStatus, "trialing")));
      paused.push(u.email);
      await logEvent({
        source: "auth",
        event: "trial_paused",
        message: `Essai terminé : compte ${u.id} mis en pause (données et numéro conservés)`,
        userId: u.id,
        metadata: { trialEndsAt: u.trialEndsAt },
      });
      continue;
    }
    const flipped = await claimTrialPause(u.id, {});
    if (!flipped) continue; // another run paused it (and owns its e-mail)
    paused.push(u.email);
    await logEvent({
      source: "auth",
      event: "trial_paused",
      message: `Essai terminé : compte ${u.id} mis en pause (données et numéro conservés)`,
      userId: u.id,
      metadata: { trialEndsAt: u.trialEndsAt, cause: "time" },
    });
    if (await sendPausedEmailOnce(flipped)) pausedEmailed.push(u.email);
  }

  // Minutes used up before the end date (switch on only): the trial ends now.
  // Prefiltered in SQL, then decided by the gate's own count and predicate
  // (signupTrialSecondsUsed + trialExhaustionCause = "minutes").
  if (trialEndEmail === "on") {
    const toPauseForMinutes = await db
      .select({ id: users.id, email: users.email, role: users.role, trialEndsAt: users.trialEndsAt, subscriptionStatus: users.subscriptionStatus })
      .from(users)
      .where(
        and(
          eq(users.subscriptionStatus, "trialing"),
          or(isNull(users.role), ne(users.role, "admin")),
          or(isNull(users.trialEndsAt), gt(users.trialEndsAt, now)),
          or(isNull(users.deletionLockedUntil), lte(users.deletionLockedUntil, now)),
          sql`(select coalesce(sum(${calls.durationSeconds}), 0) from ${calls} where ${calls.userId} = ${users.id}) >= ${TRIAL_SECONDS_LIMIT}`,
        ),
      );
    for (const u of toPauseForMinutes) {
      const trialSecondsUsed = await signupTrialSecondsUsed(u.id);
      const cause = trialExhaustionCause({ ...u, trialSecondsUsed, now });
      if (cause !== "minutes") continue;
      // trial_ends_at moves to the pause: the trial ended now, the billing
      // page's "paused since" and Phase 3's 30 days count from here.
      const flipped = await claimTrialPause(u.id, { trialEndsAt: now });
      if (!flipped) continue;
      paused.push(u.email);
      pausedForMinutesCount++;
      await logEvent({
        source: "auth",
        event: "trial_paused",
        message: `Minutes d'essai épuisées : compte ${u.id} mis en pause (données et numéro conservés)`,
        userId: u.id,
        metadata: { trialEndsAt: now, previousTrialEndsAt: u.trialEndsAt, cause: "minutes", trialSecondsUsed },
      });
      if (await sendPausedEmailOnce(flipped)) pausedEmailed.push(u.email);
    }
  }

  // ─── Phase 3 : number release after 30 days paused ───────────────────
  // The number costs money every month: after TRIAL_NUMBER_RELEASE_AFTER_MS
  // paused it goes back to Twilio (and leaves the LiveKit trunk). The account
  // and its data stay; if the customer pays later, a new number is provisioned.
  const releaseBefore = new Date(now.getTime() - TRIAL_NUMBER_RELEASE_AFTER_MS);
  const toRelease = await db
    .select({ id: users.id, email: users.email, role: users.role, trialEndsAt: users.trialEndsAt, subscriptionStatus: users.subscriptionStatus })
    .from(users)
    .where(
      and(
        eq(users.subscriptionStatus, TRIAL_PAUSED_STATUS),
        isNotNull(users.trialEndsAt),
        lte(users.trialEndsAt, releaseBefore),
        or(isNull(users.deletionLockedUntil), lte(users.deletionLockedUntil, now)),
      ),
    );
  const released: Array<{ email: string; released: number; failed: number }> = [];
  for (const u of toRelease) {
    if (!isTrialNumberReleaseDue({ ...u, now })) continue;
    const [hasNumber] = await db
      .select({ id: phoneNumbers.id })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.userId, u.id))
      .limit(1);
    if (!hasNumber) continue; // already released
    try {
      const r = await trialCleanupDeps.releaseNumbers(u.id);
      if (r.failedCount === 0) {
        await db.delete(phoneNumbers).where(eq(phoneNumbers.userId, u.id));
      }
      released.push({ email: u.email, released: r.releasedCount, failed: r.failedCount });
      await logEvent({
        source: "auth",
        event: "trial_number_released",
        message: `Essai en pause depuis 30 j : numéro(s) de ${u.id} libéré(s) · ${r.releasedCount} ok, ${r.failedCount} échec(s) — compte conservé`,
        level: r.failedCount ? "warn" : "info",
        userId: u.id,
        metadata: { released: r.releasedCount, failed: r.failedCount, errors: r.errors },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "release failed";
      await logEvent({
        source: "auth",
        event: "trial_number_release_failed",
        message: `Libération numéro ${u.id} crashed : ${msg.slice(0, 200)}`,
        level: "error",
        userId: u.id,
        metadata: { error: msg },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    warnedCount: warned.length,
    pausedCount: paused.length,
    numbersReleasedCount: released.length,
    elapsedMs: Date.now() - startedAt,
    warned,
    paused,
    released,
    // Only with the switch on, so the off response is the previous one.
    ...(trialEndEmail === "on" ? { pausedForMinutesCount, pausedEmailedCount: pausedEmailed.length } : {}),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** SQL: this users row has a PAID payment order (any kind, legacy or multi-line). */
const hasPaidOrderSql = sql`exists (select 1 from ${paymentOrders} where ${paymentOrders.userId} = ${users.id} and ${paymentOrders.status} = 'paid')`;

/** A fresh read, right before a send: does this account have a paid order? */
async function hasPaidOrder(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: paymentOrders.id })
    .from(paymentOrders)
    .where(and(eq(paymentOrders.userId, userId), eq(paymentOrders.status, "paid")))
    .limit(1);
  return !!row;
}

interface FlippedAccount {
  id: string;
  email: string;
  locale: string | null;
  role: string | null;
  hasPaidOrder: boolean;
}

/**
 * The claim: trialing -> trial_paused in ONE conditional UPDATE. Only the run
 * whose UPDATE actually flipped the row gets it back (and sends the e-mail);
 * a re-run or a concurrent run gets null.
 */
async function claimTrialPause(userId: string, extra: { trialEndsAt?: Date }): Promise<FlippedAccount | null> {
  const [row] = await db
    .update(users)
    .set({ subscriptionStatus: TRIAL_PAUSED_STATUS, ...extra })
    .where(and(eq(users.id, userId), eq(users.subscriptionStatus, "trialing")))
    .returning({
      id: users.id,
      email: users.email,
      locale: users.locale,
      role: users.role,
      hasPaidOrder: sql<boolean>`${hasPaidOrderSql}`,
    });
  return row ?? null;
}

/**
 * The paused e-mail, once, after the flip (already committed). Skipped for a
 * paid account (the RETURNING read, then a fresh read). A failure is logged
 * with its error class only, never retried: the flip is the claim, so no
 * later run sends it, and the pause stays.
 */
async function sendPausedEmailOnce(acc: FlippedAccount): Promise<boolean> {
  if (!mayEmailTrialAccount({ hasPaidOrder: acc.hasPaidOrder, role: acc.role })) return false;
  if (!mayEmailTrialAccount({ hasPaidOrder: await hasPaidOrder(acc.id), role: acc.role })) return false;
  let ok = false;
  let errorClass = "unknown";
  try {
    const [pn] = await db
      .select({ phoneNumber: phoneNumbers.phoneNumber })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.userId, acc.id))
      .limit(1);
    const res = await trialCleanupDeps.sendPaused(acc.email, { phoneNumber: pn?.phoneNumber ?? null, locale: acc.locale });
    ok = res.ok;
    if (!res.ok) errorClass = sendErrorClass(res.error);
  } catch (e) {
    errorClass = sendErrorClass(e);
  }
  await logEvent({
    source: "auth",
    event: ok ? "trial_paused_email_sent" : "trial_paused_email_failed",
    message: ok
      ? `E-mail de pause d'essai envoyé au compte ${acc.id}`
      : `Échec de l'e-mail de pause d'essai pour le compte ${acc.id} (${errorClass}), non renvoyé`,
    level: ok ? "info" : "error",
    userId: acc.id,
    metadata: ok ? {} : { errorClass },
  });
  return ok;
}
