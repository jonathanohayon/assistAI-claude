// Compat shim. La grille tarifaire vit désormais dans lib/plan-pricing.ts
// (éditable depuis /admin, persistée dans app_settings.plan_pricing). Ce
// module ne garde que les ré-exports utilisés ailleurs pour ne pas casser
// les imports existants (lib/billing-activation, callback route).

export type { PricePeriod as Period } from "@/lib/plan-pricing";
export { currencySymbol, resolvePrice } from "@/lib/plan-pricing";
