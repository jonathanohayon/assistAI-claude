// Rate card pour l'estimation des coûts (admin Finance). CLIENT-SAFE : pas
// d'import lib/db ici, le form admin l'importe côté client. La persistance
// vit dans lib/finance/rates-storage.ts (server-only). Toutes les valeurs
// sont en USD (l'admin veut « le montant en dollar ») et éditables depuis
// /admin → tuile Finance. Ce sont des ESTIMATIONS tant que le worker ne
// streame pas l'usage réel des tokens OpenAI (event `openai_usage`).

import { REALTIME_PROVIDERS, type RealtimeProvider } from "../realtime-provider";

/**
 * Per-minute engine cost, USD, per engine and model ("*" = any model of that
 * engine without its own entry). ADDITIVE to the keys above (E1 of the
 * engine override): nothing reads it on the cost path yet.
 *
 * Defaults, and why the others are absent (never an invented price):
 *   xai "*"   0.08  the worker's pricing (src/pricing.ts XAI_USD_PER_MINUTE,
 *                   xAI pricing page: grok-voice-3.0 $0.08 / min of session).
 *   openai    none  OpenAI bills per token. The finance code does NOT derive
 *                   a per-minute figure from the token rates: its only
 *                   per-minute number is the flat openaiUsdPerMinute fallback
 *                   above (a placeholder). Deriving one would need a
 *                   tokens-per-minute figure the repo does not hold, so the
 *                   key stays absent and perMinuteUsdFor() falls back to
 *                   openaiUsdPerMinute for OpenAI.
 *   gemini    none  Gemini Live bills per token (worker src/pricing.ts) and
 *                   there is no per-minute fallback anywhere: absent, and
 *                   perMinuteUsdFor() returns null (unknown).
 * The admin may add any entry through PUT /api/admin/cost-rates.
 */
export type PerMinuteUsd = Record<RealtimeProvider, Record<string, number>>;

export const DEFAULT_PER_MINUTE_USD: PerMinuteUsd = {
  openai: {},
  gemini: {},
  xai: { "*": 0.08 },
};

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
  /**
   * Transferred calls (SIP REFER): Twilio bridges the caller to the business
   * on a new OUTBOUND leg and keeps the inbound leg up meanwhile. We never
   * see that conversation, so its length is this assumed average (minutes)
   * — an ESTIMATE, priced at inbound + outbound rates.
   */
  transferAvgMinutes: number;

  // ── WhatsApp ─────────────────────────────────────────────────────
  whatsappUsdPerMessage: number;

  // ── Infra fixe (LiveKit, hébergement…) — coût mensuel global ──────
  infraUsdPerMonth: number;

  // ── FX pour convertir le revenu (EUR/ILS) → USD (marge) ──────────
  eurToUsd: number;
  ilsToUsd: number;

  // ── Per engine / model per-minute (additive, see PerMinuteUsd) ───
  perMinuteUsd: PerMinuteUsd;
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
  transferAvgMinutes: 3,
  whatsappUsdPerMessage: 0.02,
  infraUsdPerMonth: 0,
  eurToUsd: 1.08,
  ilsToUsd: 0.27,
  perMinuteUsd: DEFAULT_PER_MINUTE_USD,
};

/** The flat numeric keys (every key but perMinuteUsd), in their historic order. */
type NumericKey = Exclude<keyof CostRates, "perMinuteUsd">;
const KEYS = (Object.keys(DEFAULT_COST_RATES) as (keyof CostRates)[]).filter(
  (k): k is NumericKey => k !== "perMinuteUsd",
);

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
  // Additive key, last: absent or failing the strict parse → the defaults.
  out.perMinuteUsd = parsePerMinuteUsd(obj.perMinuteUsd) ?? structuredClone(DEFAULT_PER_MINUTE_USD);
  return out;
}

// ── perMinuteUsd: strict parse, admin write, lookup ─────────────────────

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const isEngine = (e: string): e is RealtimeProvider => (REALTIME_PROVIDERS as readonly string[]).includes(e);
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const isModelKey = (k: string) => k === "*" || MODEL_RE.test(k);
const isRate = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/** STRICT: exactly the three engines, each { "*" | model id → number ≥ 0 }. Else null. */
export function parsePerMinuteUsd(x: unknown): PerMinuteUsd | null {
  if (!isPlainObject(x)) return null;
  const keys = Object.keys(x);
  if (keys.length !== REALTIME_PROVIDERS.length || !keys.every(isEngine)) return null;
  const out = {} as PerMinuteUsd;
  for (const e of REALTIME_PROVIDERS) {
    const entry = x[e];
    if (!isPlainObject(entry)) return null;
    const parsed: Record<string, number> = {};
    for (const [m, v] of Object.entries(entry)) {
      if (!isModelKey(m) || !isRate(v)) return null;
      parsed[m] = v;
    }
    out[e] = parsed;
  }
  return out;
}

export type CostRatesWrite =
  | { ok: true; value: CostRates; changed: boolean }
  | { ok: false; error: "invalid_cost_rates"; fields: string[] };

/**
 * The PUT /api/admin/cost-rates write, from the RAW parsed body (`{ rates }`
 * or the rates object itself, as today). A PARTIAL update over `stored`:
 *   - Historic numeric keys: OMITTED → the stored value, unchanged. Present →
 *     must be what the historic coercion accepts (a finite number >= 0, or a
 *     numeric string); anything else (negative, NaN, null, boolean, "",
 *     object…) → refused naming every bad key, nothing written. Unknown keys
 *     are ignored, as before.
 *   - perMinuteUsd: OMITTED → the stored value, unchanged. Present → a
 *     partial patch { engine: { model | "*": number ≥ 0 | null } } merged
 *     onto the stored value (null removes the entry). Any unknown engine,
 *     bad model id or bad amount → refused naming every path, nothing written.
 *   - A body that is not an object (or whose `rates` is not one) → refused
 *     (fields ["rates"]). `{}` / `{ rates: {} }` → accepted, nothing changes.
 * The Finance form posts every key, so its result is identical to before.
 */
export function costRatesWrite(stored: CostRates, body: unknown): CostRatesWrite {
  const raw = isPlainObject(body) ? (body.rates ?? body) : body;
  if (!isPlainObject(raw)) return { ok: false, error: "invalid_cost_rates", fields: ["rates"] };
  const bad: string[] = [];
  const next: CostRates = { ...normalizeCostRates(stored), perMinuteUsd: structuredClone(stored.perMinuteUsd) };
  for (const k of KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, k) || raw[k] === undefined) continue;
    const v = raw[k];
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (Number.isFinite(n) && n >= 0) next[k] = n;
    else bad.push(k);
  }
  const patch = raw.perMinuteUsd;
  if (patch !== undefined) {
    if (!isPlainObject(patch)) bad.push("perMinuteUsd");
    else {
      for (const [e, entry] of Object.entries(patch)) {
        if (!isEngine(e) || !isPlainObject(entry)) {
          bad.push(`perMinuteUsd.${e}`);
          continue;
        }
        for (const [m, v] of Object.entries(entry)) {
          if (!isModelKey(m) || !(v === null || isRate(v))) {
            bad.push(`perMinuteUsd.${e}.${m}`);
            continue;
          }
          if (v === null) delete next.perMinuteUsd[e][m];
          else next.perMinuteUsd[e][m] = v;
        }
      }
    }
  }
  if (bad.length) return { ok: false, error: "invalid_cost_rates", fields: bad };
  return { ok: true, value: next, changed: JSON.stringify(next) !== JSON.stringify(stored) };
}

/**
 * Per-minute cost of an engine/model: its model entry, else its "*" entry;
 * for OpenAI without one, the existing openaiUsdPerMinute fallback; else
 * null (unknown — never a guessed price).
 */
export function perMinuteUsdFor(
  rates: Pick<CostRates, "perMinuteUsd" | "openaiUsdPerMinute">,
  engine: RealtimeProvider,
  model: string | null | undefined,
): number | null {
  const entry = rates.perMinuteUsd[engine] ?? {};
  if (model && Object.prototype.hasOwnProperty.call(entry, model)) return entry[model]!;
  if (Object.prototype.hasOwnProperty.call(entry, "*")) return entry["*"]!;
  return engine === "openai" ? rates.openaiUsdPerMinute : null;
}
