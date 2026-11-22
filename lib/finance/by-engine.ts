// Per engine / model cost breakdown for the admin Finance box (E3 of the
// engine override). Pure (no DB): lib/finance/cost.ts loads the rows,
// scripts/tests/finance-by-engine.test.ts covers the rules.
//
// It applies the SAME per-row cost rule as the historic engine cost
// (lib/finance/openai-cost.ts), only split by the engine actually used:
//   - an OpenAI usage row (metadata.provider absent or "openai") is priced
//     from its tokens with the rate card's single OpenAI token rate set. The
//     rate card has no per-model token rates, so every such group is marked
//     rateBasis "openai-flat" (never an invented per-model rate);
//   - any other usage row (Gemini, Grok) adds the worker's costUsd as-is:
//     rateBasis "worker-reported";
//   - call time no usage event covers is estimated per minute at
//     openaiUsdPerMinute, exactly as today, per bucket: it belongs to no
//     known engine, so it is one "unmetered" group with rateBasis
//     "openai-per-minute-estimate" and calls null (not counted).
// So the sum of every group's cost is the historic `totals.openai` (up to the
// cent rounding of each figure).

import type { CostRates } from "./rates";

export type EngineRateBasis =
  | "openai-flat"
  | "worker-reported"
  | "openai-per-minute-estimate";

export interface EngineCost {
  /** Engine actually used: event metadata, else the call's realtime_provider, else "unknown"; "unmetered" for the estimate remainder. */
  provider: string;
  /** Model actually used: event metadata, else the call's realtime_model; null when unknown. */
  model: string | null;
  rateBasis: EngineRateBasis;
  /** Distinct calls with a usage event in this group; null for "unmetered". */
  calls: number | null;
  /** Call minutes this group covers (usage durationSeconds / uncovered time). */
  minutes: number;
  costUsd: number;
  /** costUsd / minutes; null when minutes is 0. */
  costPerMinuteUsd: number | null;
}

/** One SQL group of usage events (lib/finance/cost.ts loadEngineUsage). */
export interface EngineUsageRow {
  /** The historic cost rule: true = priced from tokens at OpenAI rates. */
  openaiRow: boolean;
  provider: string;
  model: string | null;
  calls: number;
  seconds: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  /** Sum of the worker's costUsd (used for non-OpenAI rows only). */
  costUsd: number;
}

/** The per-bucket usage the historic computation built (a RawUsage subset). */
export interface EngineBucketUsage {
  inboundSeconds: number;
  outboundSeconds: number;
  openaiCoveredSeconds: number;
}

type Rates = Pick<
  CostRates,
  | "openaiUsdPerMinute"
  | "openaiUsdPerInputToken"
  | "openaiUsdPerOutputToken"
  | "openaiUsdPerCachedInputToken"
>;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

interface Acc {
  provider: string;
  model: string | null;
  rateBasis: EngineRateBasis;
  calls: number | null;
  seconds: number;
  cost: number;
}

/** Unrounded groups (exported for the sum invariant test). */
export function engineGroupsRaw(
  rows: EngineUsageRow[],
  buckets: EngineBucketUsage[],
  rates: Rates,
): Acc[] {
  const groups = new Map<string, Acc>();
  for (const r of rows) {
    const rateBasis: EngineRateBasis = r.openaiRow ? "openai-flat" : "worker-reported";
    const cost = r.openaiRow
      ? r.inputTokens * rates.openaiUsdPerInputToken +
        r.outputTokens * rates.openaiUsdPerOutputToken +
        r.cachedTokens * rates.openaiUsdPerCachedInputToken
      : r.costUsd;
    const key = JSON.stringify([r.provider, r.model, rateBasis]);
    const g = groups.get(key) ?? { provider: r.provider, model: r.model, rateBasis, calls: 0, seconds: 0, cost: 0 };
    g.calls = (g.calls ?? 0) + r.calls;
    g.seconds += r.seconds;
    g.cost += cost;
    groups.set(key, g);
  }
  // The historic per-bucket estimate of the time no usage event covers.
  let uncovered = 0;
  for (const b of buckets)
    uncovered += Math.max(0, b.inboundSeconds + b.outboundSeconds - b.openaiCoveredSeconds);
  const out = [...groups.values()];
  if (uncovered > 0)
    out.push({
      provider: "unmetered",
      model: null,
      rateBasis: "openai-per-minute-estimate",
      calls: null,
      seconds: uncovered,
      cost: (uncovered / 60) * rates.openaiUsdPerMinute,
    });
  return out;
}

/** The `byEngine` array of the admin finance response, most expensive first. */
export function engineBreakdown(
  rows: EngineUsageRow[],
  buckets: EngineBucketUsage[],
  rates: Rates,
): EngineCost[] {
  return engineGroupsRaw(rows, buckets, rates)
    .map((g) => ({
      provider: g.provider,
      model: g.model,
      rateBasis: g.rateBasis,
      calls: g.calls,
      minutes: round2(g.seconds / 60),
      costUsd: round4(g.cost),
      costPerMinuteUsd: g.seconds > 0 ? round4(g.cost / (g.seconds / 60)) : null,
    }))
    .sort(
      (a, b) =>
        b.costUsd - a.costUsd ||
        a.provider.localeCompare(b.provider) ||
        (a.model ?? "").localeCompare(b.model ?? "") ||
        a.rateBasis.localeCompare(b.rateBasis),
    );
}
