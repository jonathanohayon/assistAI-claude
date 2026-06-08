// Rate card pour l'estimation des coûts (admin Finance). CLIENT-SAFE : pas
// d'import lib/db ici, le form admin l'importe côté client. La persistance
// vit dans lib/finance/rates-storage.ts (server-only). Toutes les valeurs
// sont en USD (l'admin veut « le montant en dollar ») et éditables depuis
// /admin → tuile Finance. Ce sont des ESTIMATIONS tant que le worker ne
// streame pas l'usage réel des tokens OpenAI (event `openai_usage`).

export interface CostRates {
  // ── OpenAI Realtime ──────────────────────────────────────────────
  // Fallback quand l'usage token réel n'est pas (encore) loggué : coût
  // estimé = minutes d'appel × ce taux.
  openaiUsdPerMinute: number;
  // Utilisés quand des events `openai_usage` existent (tokens réels).
  openaiUsdPerInputToken: number;
  openaiUsdPerOutputToken: number;
  openaiUsdPerCachedInputToken: number;

  // ── Twilio voix ──────────────────────────────────────────────────
  twilioInboundUsdPerMinute: number;
  twilioOutboundUsdPerMinute: number;
  twilioNumberUsdPerMonth: number;

  // ── WhatsApp ─────────────────────────────────────────────────────
  whatsappUsdPerMessage: number;

  // ── Infra fixe (LiveKit, hébergement…) — coût mensuel global ──────
  infraUsdPerMonth: number;

  // ── FX pour convertir le revenu (EUR/ILS) → USD (marge) ──────────
  eurToUsd: number;
  ilsToUsd: number;
}

// Placeholders raisonnables — l'admin ajuste depuis l'UI. Ordres de grandeur
// publics 2025/2026 ; à confirmer sur les factures réelles.
export const DEFAULT_COST_RATES: CostRates = {
  openaiUsdPerMinute: 0.3,
  openaiUsdPerInputToken: 0.00004, // ~$40 / 1M tokens (audio in)
  openaiUsdPerOutputToken: 0.00008, // ~$80 / 1M tokens (audio out)
  openaiUsdPerCachedInputToken: 0.0000004,
  twilioInboundUsdPerMinute: 0.0085,
  twilioOutboundUsdPerMinute: 0.14,
  twilioNumberUsdPerMonth: 1.15,
  whatsappUsdPerMessage: 0.02,
  infraUsdPerMonth: 0,
  eurToUsd: 1.08,
  ilsToUsd: 0.27,
};

const KEYS = Object.keys(DEFAULT_COST_RATES) as (keyof CostRates)[];

/** Coerce une valeur arbitraire en nombre fini >= 0, sinon le défaut. */
function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Normalise un objet partiel/inconnu en CostRates complet et sûr. */
export function normalizeCostRates(raw: unknown): CostRates {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const out = {} as CostRates;
  for (const k of KEYS) {
    out[k] = num(obj[k], DEFAULT_COST_RATES[k]);
  }
  return out;
}
