// Grille tarifaire éditable depuis /admin (app_settings.plan_pricing).
// Client-safe : PAS d'import lib/db ici (le form admin et le billing client
// l'importent). La persistance DB est dans lib/plan-pricing-storage.ts.
//
// 4 montants par plan : EUR + ILS, mensuel + annuel (total facturé pour la
// période). EUR par défaut = lib/plans.ts ; ILS par défaut = validés owner
// 2026-06-03. La devise réelle est choisie selon la locale tenant
// (currencyForLocale : he→ILS, sinon EUR).

import { PLANS, type PlanKey } from "@/lib/plans";

export type PriceCurrency = "EUR" | "ILS";
export type PricePeriod = "monthly" | "annual";

export interface PlanPrice {
  eurMonthly: number;
  eurAnnual: number;
  ilsMonthly: number;
  ilsAnnual: number;
}
export type PlanPricingMap = Record<PlanKey, PlanPrice>;

export const PRICE_FIELDS: readonly (keyof PlanPrice)[] = [
  "eurMonthly",
  "eurAnnual",
  "ilsMonthly",
  "ilsAnnual",
] as const;

// ILS par défaut (validés owner 2026-06-03).
const DEFAULT_ILS: Record<PlanKey, { monthly: number; annual: number }> = {
  whatsapp: { monthly: 199, annual: 1990 },
  global: { monthly: 449, annual: 4490 },
  premium: { monthly: 999, annual: 9990 },
};

export const DEFAULT_PLAN_PRICING: PlanPricingMap = Object.fromEntries(
  PLANS.map((p) => [
    p.key,
    {
      eurMonthly: p.monthly,
      eurAnnual: p.annualTotal,
      ilsMonthly: DEFAULT_ILS[p.key].monthly,
      ilsAnnual: DEFAULT_ILS[p.key].annual,
    } satisfies PlanPrice,
  ]),
) as PlanPricingMap;

/**
 * Coerce une valeur arbitraire (JSON DB ou body admin) en grille complète :
 * on part des défauts et on n'override que les champs numériques valides
 * (≥ 0, finis). Robuste au JSON partiel/corrompu.
 */
export function normalizePlanPricing(raw: unknown): PlanPricingMap {
  const out: PlanPricingMap = JSON.parse(JSON.stringify(DEFAULT_PLAN_PRICING));
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const p of PLANS) {
      const v = r[p.key];
      if (v && typeof v === "object") {
        const vp = v as Record<string, unknown>;
        for (const f of PRICE_FIELDS) {
          const n = vp[f];
          if (typeof n === "number" && Number.isFinite(n) && n >= 0) {
            out[p.key][f] = n;
          }
        }
      }
    }
  }
  return out;
}

/** Montant à facturer pour un plan/période/devise donnés. Lecture pure. */
export function resolvePrice(
  pricing: PlanPricingMap,
  planKey: PlanKey,
  period: PricePeriod,
  currency: PriceCurrency,
): number {
  const row = pricing[planKey] ?? DEFAULT_PLAN_PRICING[planKey];
  if (currency === "ILS") {
    return period === "annual" ? row.ilsAnnual : row.ilsMonthly;
  }
  return period === "annual" ? row.eurAnnual : row.eurMonthly;
}

/** Symbole d'affichage de la devise. */
export function currencySymbol(currency: PriceCurrency): string {
  return currency === "ILS" ? "₪" : "€";
}
