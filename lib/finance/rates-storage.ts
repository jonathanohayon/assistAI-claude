// Persistance server-only de la rate card (app_settings.cost_rates). Séparé
// de lib/finance/rates.ts pour ne pas pull lib/db dans le bundle client (le
// form admin importe les types depuis rates.ts). Même pattern que
// lib/plan-pricing-storage.ts.

import {
  DEFAULT_COST_RATES,
  normalizeCostRates,
  type CostRates,
} from "@/lib/finance/rates";
import { SETTING_KEYS, getJsonSetting, setSetting } from "@/lib/settings";

export async function getCostRates(): Promise<CostRates> {
  // getJsonSetting gère absent/corrompu → copie de DEFAULT_COST_RATES.
  return getJsonSetting(SETTING_KEYS.COST_RATES, DEFAULT_COST_RATES, normalizeCostRates);
}

export async function setCostRates(rates: unknown): Promise<void> {
  await setSetting(
    SETTING_KEYS.COST_RATES,
    JSON.stringify(normalizeCostRates(rates)),
  );
}
