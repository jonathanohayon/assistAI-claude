// Logique PURE et testable du cycle de vie d'un abonnement (upgrade/downgrade,
// fenêtre de période courante, date effective d'un downgrade). Aucune dépendance
// DB / réseau / React : tout passe par des paramètres, et l'horloge `now` est
// toujours injectée (jamais de Date.now() interne) pour rester déterministe et
// testable via tsx.
//
// On réutilise addPeriod() de billing-activation plutôt que de redupliquer le
// calcul d'ajout de période, et on fournit son miroir subtractPeriod() pour
// dériver les débuts de période.

import type { PlanKey } from "@/lib/plans";
import type { Period } from "@/lib/billing-pricing";
import { addPeriod } from "@/lib/billing-activation";

/**
 * Ordre des plans : whatsapp < global < premium. Sert à classifier un
 * changement de plan (upgrade vs downgrade) indépendamment du prix affiché.
 */
export const PLAN_RANK: Record<PlanKey, number> = {
  whatsapp: 0,
  global: 1,
  premium: 2,
};

/**
 * Classe un changement de plan par rang. "same" si identique, "upgrade" si on
 * monte en gamme, "downgrade" si on descend.
 */
export function classifyChange(
  current: PlanKey,
  next: PlanKey,
): "upgrade" | "downgrade" | "same" {
  const a = PLAN_RANK[current];
  const b = PLAN_RANK[next];
  if (b > a) return "upgrade";
  if (b < a) return "downgrade";
  return "same";
}

/**
 * Miroir de addPeriod() : retranche une période (mensuelle/annuelle) à une date.
 * Utilisé pour dériver le début d'une période payée à partir de sa fin.
 */
export function subtractPeriod(date: Date, period: Period): Date {
  const d = new Date(date.getTime());
  if (period === "annual") {
    d.setFullYear(d.getFullYear() - 1);
  } else {
    d.setMonth(d.getMonth() - 1);
  }
  return d;
}

/**
 * Vue minimale d'un utilisateur côté abonnement. Les champs reflètent les
 * colonnes users.* (statut/plan/période + bornes d'essai et de paiement).
 */
export type SubUser = {
  subscriptionStatus: string;
  subscriptionPlan: string;
  subscriptionPeriod: "monthly" | "annual" | null;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
};

/**
 * Fenêtre [start, end] de la période courante + sa nature.
 *
 * Priorités :
 *  1. "paid"   — statut "active" OU paidUntil dans le futur. La fin est
 *                paidUntil ; le début est dérivé en retranchant une période
 *                (subtractPeriod) pour que addPeriod(start) === end.
 *  2. "trial"  — sinon, trialEndsAt dans le futur. La fin est trialEndsAt ; on
 *                ne connaît pas la vraie date de début d'essai ici, on prend une
 *                borne sensée = trialEndsAt - 1 jour (essai court 1 jour, cf.
 *                trial_system) afin d'exposer une fenêtre non vide.
 *  3. "expired"— sinon. La fin est paidUntil ?? now ; le début = fin - 1 mois.
 *
 * La période (monthly/annual) par défaut est "monthly" si non renseignée.
 */
export function currentPeriodWindow(
  user: SubUser,
  now: Date,
): { start: Date; end: Date; kind: "trial" | "paid" | "expired" } {
  const period: Period = user.subscriptionPeriod ?? "monthly";
  const paidInFuture =
    user.paidUntil != null && user.paidUntil.getTime() > now.getTime();

  if (user.subscriptionStatus === "active" || paidInFuture) {
    // Fin = paidUntil si dispo, sinon on s'appuie sur now + période (cas
    // "active" sans paidUntil renseigné).
    const end = user.paidUntil ?? addPeriod(now, period);
    const start = subtractPeriod(end, period);
    return { start, end, kind: "paid" };
  }

  if (user.trialEndsAt != null && user.trialEndsAt.getTime() > now.getTime()) {
    const end = user.trialEndsAt;
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    return { start, end, kind: "trial" };
  }

  const end = user.paidUntil ?? now;
  const start = subtractPeriod(end, "monthly");
  return { start, end, kind: "expired" };
}

/**
 * Date à laquelle un downgrade prend effet : la fin de la période déjà payée
 * (paidUntil) si elle est dans le futur — l'utilisateur garde son plan courant
 * jusque-là — sinon immédiatement (now) si rien n'est payé.
 */
export function effectiveDowngradeDate(user: SubUser, now: Date): Date {
  if (user.paidUntil != null && user.paidUntil.getTime() > now.getTime()) {
    return user.paidUntil;
  }
  return now;
}
