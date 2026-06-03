// Logique PURE et testable de l'activation d'abonnement après retour HYP.
// Extraite du route handler /api/dashboard/hyp/callback pour :
//   - être couverte par des tests unitaires (tsx) sans réseau ni DB
//   - garder le handler concentré sur l'orchestration DB/redirect
//
// Sécurité (cf. revue council 2026-06-03) : on ne fait JAMAIS confiance aux
// montants/plan/devise renvoyés dans la redirection — on les compare à la
// ligne payment_orders créée AVANT le paiement.

import type { Period } from "@/lib/billing-pricing";

/** Ajoute une période (mensuelle/annuelle) à une date. */
export function addPeriod(date: Date, period: Period): Date {
  const d = new Date(date.getTime());
  if (period === "annual") {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d;
}

/**
 * Nouvelle date de fin de période payée. On part du max(paidUntil courant, now)
 * pour qu'un renouvellement anticipé empile la durée, mais qu'un paiement après
 * expiration reparte de maintenant (pas de durée perdue ni offerte).
 */
export function nextPaidUntil(
  currentPaidUntil: Date | null | undefined,
  now: Date,
  period: Period,
): Date {
  const base =
    currentPaidUntil && currentPaidUntil.getTime() > now.getTime()
      ? currentPaidUntil
      : now;
  return addPeriod(base, period);
}

export type ExpectedOrder = {
  expectedAmount: number;
  coin: string;
  status: string;
  expiresAt: Date;
};

/**
 * Valide que le retour HYP correspond bien à l'ordre attendu. À appeler APRÈS
 * verifyPayment() (qui confirme CCode==0 via re-signature HYP). Ici on lie le
 * montant et la devise pour empêcher qu'un retour valide d'un autre montant /
 * d'une autre devise n'active un plan non payé.
 *
 * @param order  ligne payment_orders (montant/devise attendus + statut/expiry)
 * @param raw    paramètres bruts renvoyés par HYP (Amount, Coin, …)
 * @param now    horloge injectée (testabilité)
 */
export function validateHypReturn(
  order: ExpectedOrder,
  raw: Record<string, string>,
  now: Date,
): { ok: boolean; reason?: string } {
  if (order.status === "paid") {
    // Déjà activé — l'appelant gère l'idempotence, pas une erreur.
    return { ok: true, reason: "already_paid" };
  }
  if (order.status !== "pending") {
    return { ok: false, reason: `bad_status:${order.status}` };
  }
  if (order.expiresAt.getTime() < now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  const returnedAmount = Number.parseFloat(raw["Amount"] ?? "");
  if (!Number.isFinite(returnedAmount)) {
    return { ok: false, reason: "missing_amount" };
  }
  if (returnedAmount.toFixed(2) !== order.expectedAmount.toFixed(2)) {
    return {
      ok: false,
      reason: `amount_mismatch:${returnedAmount}!=${order.expectedAmount}`,
    };
  }

  const returnedCoin = raw["Coin"];
  if (returnedCoin != null && returnedCoin !== order.coin) {
    return { ok: false, reason: `coin_mismatch:${returnedCoin}!=${order.coin}` };
  }

  return { ok: true };
}
