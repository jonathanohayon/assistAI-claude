// Finance: transferred-call leg + real inbound duration (lib/finance/cost.ts).
// Run with:  npx tsx scripts/tests/finance-transfer.test.ts

import assert from "node:assert/strict";

import { costFromUsage } from "../../lib/finance/cost";
import { DEFAULT_COST_RATES, normalizeCostRates } from "../../lib/finance/rates";

const base = {
  inboundSeconds: 600, // 10 min
  outboundSeconds: 0,
  whatsappMessages: 0,
  openaiInputTokens: 0,
  openaiOutputTokens: 0,
  openaiCachedTokens: 0,
  openaiUsageRows: 0,
  openaiCoveredSeconds: 0,
  otherEngineCostUsd: 0,
  numbersActive: 0,
  transfers: 0,
};
const rates = { ...DEFAULT_COST_RATES, twilioInboundUsdPerMinute: 0.01, twilioOutboundUsdPerMinute: 0.1, transferAvgMinutes: 3 };

// no transfer: unchanged formula
assert.equal(costFromUsage(base, rates, 1, { includeInfra: false }).twilioVoice, 0.1);
// 2 transfers × 3 min × (0.01 + 0.10) = 0.66 on top
assert.equal(costFromUsage({ ...base, transfers: 2 }, rates, 1, { includeInfra: false }).twilioVoice, 0.76);
// average 0 → no transfer cost (admin can switch the estimate off)
assert.equal(costFromUsage({ ...base, transfers: 2 }, { ...rates, transferAvgMinutes: 0 }, 1, { includeInfra: false }).twilioVoice, 0.1);

// rate card: new key has a default, survives normalisation, rejects junk
assert.equal(DEFAULT_COST_RATES.transferAvgMinutes, 3);
assert.equal(normalizeCostRates({}).transferAvgMinutes, 3);
assert.equal(normalizeCostRates({ transferAvgMinutes: 5 }).transferAvgMinutes, 5);
assert.equal(normalizeCostRates({ transferAvgMinutes: -1 }).transferAvgMinutes, 3);

console.log("ALL FINANCE-TRANSFER TESTS PASSED");
