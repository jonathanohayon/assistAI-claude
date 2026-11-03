// Pure OpenAI cost formula for the admin Finance box (no DB, unit-tested in
// scripts/tests/finance-openai-cost.test.ts).

import type { CostRates } from "./rates";

/**
 * OpenAI cost for one bucket, priced per call rather than per bucket: calls
 * that reported real usage are billed by token, and only the call time NOT
 * covered by a usage event is estimated per minute. Switching the whole
 * bucket to tokens as soon as one usage row existed priced every unreported
 * call in it at $0, which is exactly what happens while the worker rolls out.
 *
 * Call time comes from different sources (inbound is estimated from the
 * transcript length, the usage event carries the worker's wall-clock), so the
 * uncovered remainder is clamped at zero rather than going negative.
 */
export function openaiCostUsd(
  u: {
    inboundSeconds: number;
    outboundSeconds: number;
    openaiInputTokens: number;
    openaiOutputTokens: number;
    openaiCachedTokens: number;
    openaiCoveredSeconds: number;
    /** Gemini / Grok cost as reported by the worker (already in USD). */
    otherEngineCostUsd?: number;
  },
  rates: Pick<
    CostRates,
    | "openaiUsdPerMinute"
    | "openaiUsdPerInputToken"
    | "openaiUsdPerOutputToken"
    | "openaiUsdPerCachedInputToken"
  >,
): number {
  const real =
    u.openaiInputTokens * rates.openaiUsdPerInputToken +
    u.openaiOutputTokens * rates.openaiUsdPerOutputToken +
    u.openaiCachedTokens * rates.openaiUsdPerCachedInputToken +
    (u.otherEngineCostUsd ?? 0);
  const uncoveredSeconds = Math.max(
    0,
    u.inboundSeconds + u.outboundSeconds - u.openaiCoveredSeconds,
  );
  return real + (uncoveredSeconds / 60) * rates.openaiUsdPerMinute;
}
