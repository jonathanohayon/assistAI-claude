// Unit tests for the per-call OpenAI cost formula (lib/finance/openai-cost.ts).
// Run with:  npx tsx scripts/tests/finance-openai-cost.test.ts

import assert from "node:assert/strict";

import { openaiCostUsd } from "../../lib/finance/openai-cost";

const rates = {
  openaiUsdPerMinute: 0.3,
  openaiUsdPerInputToken: 0.00004,
  openaiUsdPerOutputToken: 0.00008,
  openaiUsdPerCachedInputToken: 0.0000004,
};
const none = {
  openaiInputTokens: 0,
  openaiOutputTokens: 0,
  openaiCachedTokens: 0,
  openaiCoveredSeconds: 0,
};
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

// no usage reported: the whole bucket is estimated per minute
close(openaiCostUsd({ inboundSeconds: 600, outboundSeconds: 0, ...none }, rates), 3);

// THE BUG: one reported call must not price the other calls of the bucket at $0
{
  const cost = openaiCostUsd(
    {
      inboundSeconds: 600, // 10 min of calls in the bucket
      outboundSeconds: 0,
      openaiInputTokens: 1000,
      openaiOutputTokens: 500,
      openaiCachedTokens: 0,
      openaiCoveredSeconds: 120, // only a 2-min call reported usage
    },
    rates,
  );
  // real 0.04 + 0.04, plus 8 uncovered minutes estimated at 0.3
  close(cost, 0.08 + 2.4);
}

// fully covered: real tokens only, nothing estimated
close(
  openaiCostUsd(
    { inboundSeconds: 60, outboundSeconds: 60, ...none, openaiInputTokens: 100, openaiCoveredSeconds: 120 },
    rates,
  ),
  0.004,
);

// covered time above the estimated call time never yields a negative estimate
close(
  openaiCostUsd(
    { inboundSeconds: 30, outboundSeconds: 0, ...none, openaiOutputTokens: 10, openaiCoveredSeconds: 90 },
    rates,
  ),
  0.0008,
);

console.log("ALL FINANCE-OPENAI-COST TESTS PASSED");
