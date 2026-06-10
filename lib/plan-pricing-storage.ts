// Persistance server-only de la grille tarifaire (app_settings.plan_pricing).
// Séparé de lib/plan-pricing.ts pour ne pas pull lib/db dans le bundle
// client (form admin + billing client importent lib/plan-pricing). Même
// pattern que lib/plan-features-storage.ts.

import {
  DEFAULT_PLAN_PRICING,
  normalizePlanPricing,
  type PlanPricingMap,
} from "@/lib/plan-pricing";
import { SETTING_KEYS, getJsonSetting, setSetting } from "@/lib/settings";

export async function getPlanPricingMap(): Promise<PlanPricingMap> {
  // getJsonSetting gère absent/corrompu → copie de DEFAULT_PLAN_PRICING.
  return getJsonSetting(
    SETTING_KEYS.PLAN_PRICING,
    DEFAULT_PLAN_PRICING,
    normalizePlanPricing,
  );
}

export async function setPlanPricingMap(map: unknown): Promise<void> {
  await setSetting(
    SETTING_KEYS.PLAN_PRICING,
    JSON.stringify(normalizePlanPricing(map)),
  );
}
