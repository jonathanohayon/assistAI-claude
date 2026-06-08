// Persistance server-only de la rate card (app_settings.cost_rates). Séparé
// de lib/finance/rates.ts pour ne pas pull lib/db dans le bundle client (le
// form admin importe les types depuis rates.ts). Même pattern que
// lib/plan-pricing-storage.ts.

import {
  DEFAULT_COST_RATES,
  normalizeCostRates,
  type CostRates,
} from "@/lib/finance/rates";
import { SETTING_KEYS, getSetting, setSetting } from "@/lib/settings";

export async function getCostRates(): Promise<CostRates> {
  const raw = await getSetting(SETTING_KEYS.COST_RATES);
  if (!raw) return { ...DEFAULT_COST_RATES };
  try {
    return normalizeCostRates(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_COST_RATES };
  }
}

export async function setCostRates(rates: unknown): Promise<void> {
  await setSetting(
    SETTING_KEYS.COST_RATES,
    JSON.stringify(normalizeCostRates(rates)),
  );
}
