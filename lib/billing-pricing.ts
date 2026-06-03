// Source de vérité des MONTANTS facturés par plan / période / devise.
//
// - EUR : repris de lib/plans.ts (monthly / annualTotal) — déjà affichés sur
//   la landing, on garde la cohérence.
// - ILS : ⚠️ PLACEHOLDERS à confirmer avec le owner (le masof HYP est
//   historiquement ILS-only ; les vrais prix shekel doivent être validés).
//   Modifier UNIQUEMENT ici quand les prix officiels sont connus.
//
// Le montant est résolu côté serveur dans /api/dashboard/hyp/create-payment ;
// jamais envoyé depuis le client.

import { planByKey, type PlanKey } from "@/lib/plans";
import type { Currency } from "@/lib/hyp";

export type Period = "monthly" | "annual";

// Prix ILS par plan/période. TODO(owner): confirmer les montants réels.
const ILS_PRICES: Record<PlanKey, Record<Period, number>> = {
  whatsapp: { monthly: 199, annual: 1990 },
  global: { monthly: 449, annual: 4490 },
  premium: { monthly: 999, annual: 9990 },
};

/**
 * Montant à facturer pour un plan/période/devise. EUR vient de lib/plans.ts
 * (annualTotal = total facturé en une fois pour l'année), ILS de la table
 * ci-dessus.
 */
export function priceFor(
  planKey: PlanKey,
  period: Period,
  currency: Currency,
): number {
  if (currency === "ILS") {
    return ILS_PRICES[planKey][period];
  }
  const plan = planByKey(planKey);
  return period === "annual" ? plan.annualTotal : plan.monthly;
}

/** Symbole d'affichage de la devise. */
export function currencySymbol(currency: Currency): string {
  return currency === "ILS" ? "₪" : "€";
}
