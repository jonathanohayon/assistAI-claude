// Finance per engine / model (E3, lib/finance/by-engine.ts): grouping, the
// per-group cost rule, and the sum invariant against the historic formula.
// Mock values only. Run with:  npx tsx scripts/tests/finance-by-engine.test.ts

import assert from "node:assert/strict";

import { engineBreakdown, engineGroupsRaw, type EngineUsageRow } from "../../lib/finance/by-engine";
import { openaiCostUsd } from "../../lib/finance/openai-cost";
import { DEFAULT_COST_RATES } from "../../lib/finance/rates";

const rates = {
  ...DEFAULT_COST_RATES,
  openaiUsdPerMinute: 0.3,
  openaiUsdPerInputToken: 0.00004,
  openaiUsdPerOutputToken: 0.00008,
  openaiUsdPerCachedInputToken: 0.0000004,
};
const row = (o: Partial<EngineUsageRow>): EngineUsageRow => ({
  openaiRow: true,
  provider: "openai",
  model: "gpt-realtime-2",
  calls: 1,
  seconds: 60,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  costUsd: 0,
  ...o,
});

// ── OpenAI rows: token re-pricing at the single rate set, marked flat ──
{
  const out = engineBreakdown(
    [row({ inputTokens: 10_000, outputTokens: 5_000, cachedTokens: 1_000, costUsd: 9.99, seconds: 120, calls: 2 })],
    [],
    rates,
  );
  assert.deepEqual(out, [
    {
      provider: "openai",
      model: "gpt-realtime-2",
      rateBasis: "openai-flat",
      calls: 2,
      minutes: 2,
      // 10k × 0.00004 + 5k × 0.00008 + 1k × 0.0000004 = 0.4 + 0.4 + 0.0004; the worker's costUsd is ignored
      costUsd: 0.8004,
      costPerMinuteUsd: 0.4002,
    },
  ]);
}

// ── Other engines: the worker's costUsd as-is, tokens ignored ──
{
  const out = engineBreakdown(
    [
      row({ openaiRow: false, provider: "xai", model: "grok-voice-3.0", costUsd: 0.24, seconds: 180, inputTokens: 999 }),
      row({ openaiRow: false, provider: "gemini", model: "gemini-live-2.5", costUsd: 0.05, seconds: 0 }),
    ],
    [],
    rates,
  );
  assert.deepEqual(
    out.map((g) => [g.provider, g.model, g.rateBasis, g.costUsd, g.costPerMinuteUsd]),
    [
      ["xai", "grok-voice-3.0", "worker-reported", 0.24, 0.08],
      ["gemini", "gemini-live-2.5", "worker-reported", 0.05, null], // no minutes → no per-minute figure
    ],
  );
}

// ── Grouping: same (provider, model, rule) merges; a different model, a
// fallback "unknown" provider, a null model and the cost rule each split ──
{
  const out = engineBreakdown(
    [
      row({ calls: 1, seconds: 60, inputTokens: 1000 }),
      row({ calls: 2, seconds: 120, inputTokens: 1000 }),
      row({ model: "gpt-realtime-2.1", inputTokens: 1000 }),
      row({ model: null, inputTokens: 1000 }),
      row({ provider: "unknown", model: null, inputTokens: 1000 }),
      // a row with no provider whose call said gemini: still priced as OpenAI (today's rule)
      row({ provider: "gemini", model: "gemini-live-2.5", inputTokens: 1000 }),
      row({ openaiRow: false, provider: "gemini", model: "gemini-live-2.5", costUsd: 0.01 }),
    ],
    [],
    rates,
  );
  const keys = out.map((g) => `${g.provider}|${g.model}|${g.rateBasis}|${g.calls}|${g.minutes}`);
  assert.deepEqual(keys, [
    "openai|gpt-realtime-2|openai-flat|3|3",
    "gemini|gemini-live-2.5|openai-flat|1|1",
    "openai|null|openai-flat|1|1",
    "openai|gpt-realtime-2.1|openai-flat|1|1",
    "unknown|null|openai-flat|1|1",
    "gemini|gemini-live-2.5|worker-reported|1|1",
  ]);
  assert.equal(out[0].costUsd, 0.08);
}

// ── Uncovered call time: one "unmetered" group, per bucket, clamped at 0 ──
{
  const out = engineBreakdown(
    [],
    [
      { inboundSeconds: 600, outboundSeconds: 60, openaiCoveredSeconds: 60 }, // 600 s uncovered
      { inboundSeconds: 30, outboundSeconds: 0, openaiCoveredSeconds: 300 }, // over-covered: 0, not −270
    ],
    rates,
  );
  assert.deepEqual(out, [
    {
      provider: "unmetered",
      model: null,
      rateBasis: "openai-per-minute-estimate",
      calls: null,
      minutes: 10,
      costUsd: 3,
      costPerMinuteUsd: 0.3,
    },
  ]);
  // Nothing uncovered → no unmetered group.
  assert.deepEqual(engineBreakdown([], [{ inboundSeconds: 60, outboundSeconds: 0, openaiCoveredSeconds: 60 }], rates), []);
}

// ── Sum invariant: Σ groups == Σ buckets of the historic openaiCostUsd ──
{
  // Two buckets, mixed engines; per bucket the historic formula sees the
  // bucket's OpenAI tokens, other-engine cost and covered seconds.
  const b1 = { open: row({ inputTokens: 12_345, outputTokens: 6_789, cachedTokens: 321, seconds: 200 }), xai: row({ openaiRow: false, provider: "xai", model: null, costUsd: 0.4, seconds: 300 }), inbound: 900, outbound: 0 };
  const b2 = { open: row({ model: "gpt-realtime-2.1", inputTokens: 777, outputTokens: 333, seconds: 50 }), xai: row({ openaiRow: false, provider: "xai", model: null, costUsd: 0.16, seconds: 120 }), inbound: 100, outbound: 200 };
  let historic = 0;
  const buckets = [];
  for (const b of [b1, b2]) {
    const u = {
      inboundSeconds: b.inbound,
      outboundSeconds: b.outbound,
      openaiInputTokens: b.open.inputTokens,
      openaiOutputTokens: b.open.outputTokens,
      openaiCachedTokens: b.open.cachedTokens,
      openaiCoveredSeconds: b.open.seconds + b.xai.seconds,
      otherEngineCostUsd: b.xai.costUsd,
    };
    historic += openaiCostUsd(u, rates);
    buckets.push(u);
  }
  const rows = [b1.open, b1.xai, b2.open, b2.xai];
  const raw = engineGroupsRaw(rows, buckets, rates);
  const sum = raw.reduce((s, g) => s + g.cost, 0);
  assert.ok(Math.abs(sum - historic) < 1e-12, `Σ groups ${sum} == historic ${historic}`);
  const rounded = engineBreakdown(rows, buckets, rates);
  const sumRounded = rounded.reduce((s, g) => s + g.costUsd, 0);
  assert.ok(Math.abs(sumRounded - historic) <= 0.00005 * rounded.length + 1e-12);
  // xai rows of both buckets merged (model null), calls summed
  const x = rounded.find((g) => g.provider === "xai")!;
  assert.deepEqual([x.calls, x.minutes, x.costUsd, x.costPerMinuteUsd], [2, 7, 0.56, 0.08]);
}

// ── No PII: only these keys, whatever the rows hold ──
{
  const out = engineBreakdown([row({ inputTokens: 1 })], [{ inboundSeconds: 120, outboundSeconds: 0, openaiCoveredSeconds: 60 }], rates);
  for (const g of out)
    assert.deepEqual(Object.keys(g), ["provider", "model", "rateBasis", "calls", "minutes", "costUsd", "costPerMinuteUsd"]);
}

console.log("ALL FINANCE-BY-ENGINE TESTS PASSED");
