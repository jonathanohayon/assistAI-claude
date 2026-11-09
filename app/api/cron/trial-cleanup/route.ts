import { and, eq, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { phoneNumbers, users } from "@/lib/db/schema";
import { sendTrialWarningEmail } from "@/lib/email";
import { logEvent } from "@/lib/logger";
import { releaseAllTwilioNumbersFor } from "@/lib/release-user";
import {
  isTrialNumberReleaseDue,
  isTrialPauseDue,
  TRIAL_NUMBER_RELEASE_AFTER_MS,
  TRIAL_PAUSED_STATUS,
  TRIAL_WARNING_BEFORE_END_MS,
} from "@/lib/trial";

// Cron : gère la fin de free trial pour tous les tenants en `trialing`.
//
// 2026-11 (14 days / 100 min, pause instead of delete):
//   1) Warning: trial_ends_at within 2 days and not yet warned -> email,
//      stamp trial_warning_sent_at (idempotent).
//   2) Pause: trial_ends_at passed -> subscription_status = trial_paused.
//      NEVER deleted: data and number kept, calls refused until payment.
//   3) Number release: paused for 30 days -> Twilio number(s) released and
//      unmapped; the account stays.
// Admins and tenants with a HYP payment in progress are skipped.
// Auth : INTERNAL_SECRET via header x-internal-secret (Railway scheduler).

export async function GET(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;

  const startedAt = Date.now();
  const now = new Date();
  const warningCutoff = new Date(now.getTime() + TRIAL_WARNING_BEFORE_END_MS);

  // ─── Phase 1 : warnings ─────────────────────────────────────────────
  // Sélectionne les trialing dont trial_ends_at est dans la fenêtre
  // [now, now+2h] et qui n'ont pas encore été warned. Le lt(trialEndsAt,
  // warningCutoff) couvre aussi les users déjà expirés mais pas encore
  // supprimés — on leur envoie quand même un warning juste avant la
  // suppression Phase 2 (cas du tout premier tick après expiration).
  const toWarn = await db
    .select({
      id: users.id,
      email: users.email,
      trialEndsAt: users.trialEndsAt,
      locale: users.locale,
    })
    .from(users)
    .where(
      and(
        eq(users.subscriptionStatus, "trialing"),
        isNotNull(users.trialEndsAt),
        lt(users.trialEndsAt, warningCutoff),
        isNull(users.trialWarningSentAt),
      ),
    );

  const warned: Array<{ email: string; ok: boolean; reason?: string }> = [];
  for (const u of toWarn) {
    // Récupère un numéro associé pour le mettre dans l'email (best-effort).
    const [pn] = await db
      .select({ phoneNumber: phoneNumbers.phoneNumber })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.userId, u.id))
      .limit(1);

    const minutesLeft = u.trialEndsAt
      ? Math.max(0, Math.round((u.trialEndsAt.getTime() - now.getTime()) / 60000))
      : 0;
    const res = await sendTrialWarningEmail(u.email, {
      phoneNumber: pn?.phoneNumber ?? null,
      minutesLeft,
      locale: u.locale,
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
        message: `Trial warning envoyé à ${u.email} (expire dans ${minutesLeft} min)`,
        userId: u.id,
        metadata: { minutesLeft, phoneNumber: pn?.phoneNumber ?? null, emailId: res.id },
      });
    } else {
      warned.push({ email: u.email, ok: false, reason: res.error });
      await logEvent({
        source: "auth",
        event: "trial_warning_failed",
        message: `Échec envoi warning trial à ${u.email} : ${res.error?.slice(0, 200) ?? "?"}`,
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
  for (const u of toPause) {
    if (!isTrialPauseDue({ ...u, now })) continue; // admins, re-checked in code
    await db
      .update(users)
      .set({ subscriptionStatus: TRIAL_PAUSED_STATUS })
      .where(and(eq(users.id, u.id), eq(users.subscriptionStatus, "trialing")));
    paused.push(u.email);
    await logEvent({
      source: "auth",
      event: "trial_paused",
      message: `Essai terminé : compte ${u.email} mis en pause (données et numéro conservés)`,
      userId: u.id,
      metadata: { trialEndsAt: u.trialEndsAt },
    });
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
      const r = await releaseAllTwilioNumbersFor(u.id);
      if (r.failedCount === 0) {
        await db.delete(phoneNumbers).where(eq(phoneNumbers.userId, u.id));
      }
      released.push({ email: u.email, released: r.releasedCount, failed: r.failedCount });
      await logEvent({
        source: "auth",
        event: "trial_number_released",
        message: `Essai en pause depuis 30 j : numéro(s) de ${u.email} libéré(s) · ${r.releasedCount} ok, ${r.failedCount} échec(s) — compte conservé`,
        level: r.failedCount ? "warn" : "info",
        userId: u.id,
        metadata: { released: r.releasedCount, failed: r.failedCount, errors: r.errors },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "release failed";
      await logEvent({
        source: "auth",
        event: "trial_number_release_failed",
        message: `Libération numéro ${u.email} crashed : ${msg.slice(0, 200)}`,
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
  });
}
