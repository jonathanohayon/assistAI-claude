import { and, eq, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { phoneNumbers, users } from "@/lib/db/schema";
import { sendTrialDeletedEmail, sendTrialWarningEmail } from "@/lib/email";
import { logEvent } from "@/lib/logger";
import { fullyDeleteUser } from "@/lib/release-user";
import { TRIAL_WARNING_BEFORE_END_MS } from "@/lib/trial";

// Cron : gère la fin de free trial pour tous les tenants en `trialing`.
//
// Deux phases sur le même tick :
//   1) Warning : pour chaque user dont trial_ends_at ≤ now + 2h et qui
//      n'a pas encore reçu de warning (trial_warning_sent_at NULL), envoie
//      un email d'alerte puis stamp trial_warning_sent_at. Idempotent —
//      un seul email par trial même si le cron tick toutes les 5 min.
//   2) Suppression : pour chaque user dont trial_ends_at ≤ now, libère
//      ses numéros Twilio (release-user) puis cascade delete DB et envoie
//      un dernier email de confirmation. Robuste : une erreur sur un
//      tenant ne bloque pas les autres.
//
// Auth : INTERNAL_SECRET via header x-internal-secret. Pareil que
// /api/cron/sync-tenants pour cohérence — hook sur le scheduler Railway.
// Fréquence recommandée : 10–15 min. Plus rapide n'apporte rien.
//
// Admins exclus : on filtre role != 'admin' pour ne JAMAIS supprimer un
// compte admin automatiquement (failsafe — la politique métier veut que
// les admins n'ont pas de trial qui expire).

export async function GET(req: NextRequest) {
  const expected = process.env.INTERNAL_SECRET;
  const provided = req.headers.get("x-internal-secret");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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

  // ─── Phase 2 : suppressions ─────────────────────────────────────────
  // Sélectionne les trialing dont trial_ends_at est strictement passé.
  // On garde les admins hors-scope par sécurité (cf. doc top).
  const toDelete = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      locale: users.locale,
    })
    .from(users)
    .where(
      and(
        eq(users.subscriptionStatus, "trialing"),
        isNotNull(users.trialEndsAt),
        lte(users.trialEndsAt, now),
        // On saute les comptes dont deletion_locked_until est dans le futur =
        // paiement HYP en cours : ne jamais supprimer un tenant en train de payer.
        or(isNull(users.deletionLockedUntil), lte(users.deletionLockedUntil, now)),
      ),
    );

  const deleted: Array<{
    email: string;
    ok: boolean;
    twilioReleased?: number;
    twilioFailed?: number;
    reason?: string;
  }> = [];

  for (const u of toDelete) {
    if (u.role === "admin") {
      deleted.push({ email: u.email, ok: false, reason: "admin_skipped" });
      await logEvent({
        source: "auth",
        event: "trial_delete_skipped",
        message: `Trial expiré pour admin ${u.email} — suppression auto SKIPPÉE`,
        level: "warn",
        userId: u.id,
        metadata: { reason: "admin role" },
      });
      continue;
    }

    // Snapshot du premier numéro AVANT delete pour le mettre dans l'email
    // de confirmation. Lecture best-effort, l'email part même sans.
    const [pn] = await db
      .select({ phoneNumber: phoneNumbers.phoneNumber })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.userId, u.id))
      .limit(1);

    try {
      const { release } = await fullyDeleteUser(u.id);
      deleted.push({
        email: u.email,
        ok: true,
        twilioReleased: release.releasedCount,
        twilioFailed: release.failedCount,
      });
      await logEvent({
        source: "auth",
        event: "trial_account_deleted",
        message: `Compte ${u.email} supprimé (fin trial) · Twilio: ${release.releasedCount} libérés, ${release.failedCount} échecs`,
        metadata: {
          email: u.email,
          twilioReleased: release.releasedCount,
          twilioFailed: release.failedCount,
          twilioErrors: release.errors,
        },
      });
      // Email post-suppression — best-effort, on n'échoue pas la phase si
      // Resend down (le compte est déjà supprimé de toute façon).
      const mailRes = await sendTrialDeletedEmail(u.email, {
        phoneNumber: pn?.phoneNumber ?? null,
        locale: u.locale,
      });
      if (!mailRes.ok) {
        await logEvent({
          source: "auth",
          event: "trial_deleted_email_failed",
          message: `Échec envoi email post-delete à ${u.email} : ${mailRes.error?.slice(0, 200) ?? "?"}`,
          level: "warn",
          metadata: { error: mailRes.error },
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "delete failed";
      deleted.push({ email: u.email, ok: false, reason: msg });
      await logEvent({
        source: "auth",
        event: "trial_delete_failed",
        message: `Suppression trial ${u.email} crashed : ${msg.slice(0, 200)}`,
        level: "error",
        userId: u.id,
        metadata: { error: msg },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    warnedCount: warned.length,
    deletedCount: deleted.filter((d) => d.ok).length,
    deletedFailedCount: deleted.filter((d) => !d.ok).length,
    elapsedMs: Date.now() - startedAt,
    warned,
    deleted,
  });
}
