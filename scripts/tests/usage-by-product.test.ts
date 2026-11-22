// Per-product usage (lib/usage-by-product.ts): a table over both shapes.
//   - record-holders: one row per entry, its own included minutes (sum of
//     the owned products mapping to it) and its own rate, in the account's
//     currency; no shared pool; unowned usage shows with 0 included;
//   - grandfathered: exactly today's billing-stats pool (one "pool" row,
//     PLANS minutesIncluded, OVERAGE_RATE_ILS_PER_MIN, Math.round of the
//     inbound + outbound seconds).
// Plus the window bounds and the client-safe guard.
// Run with:  npx tsx scripts/tests/usage-by-product.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DEFAULT_PRODUCT_CATALOGUE } from "../../lib/product-catalogue";
import { entitledProducts } from "../../lib/product-entitlement";
import { OVERAGE_RATE_ILS_PER_MIN, PLANS } from "../../lib/plans";
import { trialUsage } from "../../lib/product-trials";
import { TRIAL_MINUTES_INCLUDED, signupTrialGateApplies } from "../../lib/trial";
import { entryOfCall, usageByProduct, type UsageByProductInput } from "../../lib/usage-by-product";

const W = { start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-12-01T00:00:00Z") };
const IN = new Date("2026-11-10T10:00:00Z");
const BEFORE = new Date("2026-10-31T23:59:59Z");
const AFTER = new Date("2026-12-01T00:00:01Z");
const cat = DEFAULT_PRODUCT_CATALOGUE;
const min = (m: number) => m * 60;

const input = (over: Partial<UsageByProductInput>): UsageByProductInput => ({
  calls: [],
  campaignCalls: [],
  window: W,
  entitlement: entitledProducts({ subscriptionPlan: "premium", subscriptionStatus: "active", products: null }),
  catalogue: cat,
  currency: "EUR",
  planMinutes: 500,
  planOverage: OVERAGE_RATE_ILS_PER_MIN,
  ...over,
});
const rec = (base: string, addons: string[] = []) =>
  entitledProducts({ subscriptionPlan: "premium", subscriptionStatus: "active", products: { base, addons } });

assert.equal(entryOfCall(null), "reception");
assert.equal(entryOfCall("reception"), "reception");
assert.equal(entryOfCall("sales"), "sales");
assert.equal(entryOfCall("connect"), "connect");
assert.equal(entryOfCall("gold"), "reception");

// ── Grandfathered: the single pool, today's numbers ─────────────────────
{
  const premium = PLANS.find((p) => p.key === "premium")!;
  const r = usageByProduct(
    input({
      planMinutes: premium.minutesIncluded,
      calls: [
        { durationSeconds: 90, product: null, createdAt: IN },
        { durationSeconds: 30, product: "connect", createdAt: IN },
        { durationSeconds: 9999, product: null, createdAt: BEFORE },
        { durationSeconds: 9999, product: null, createdAt: AFTER },
      ],
      campaignCalls: [
        { durationSeconds: 29, createdAt: IN },
        { durationSeconds: 9999, createdAt: AFTER },
      ],
    }),
  );
  // Today: Math.round((90 + 30 + 29) / 60) = 2.
  assert.deepEqual(r, {
    kind: "pool",
    currency: "ILS",
    entries: [
      { entry: "pool", usedSeconds: 149, usedMinutes: 2, includedMinutes: premium.minutesIncluded, overageMinutes: 0, overageRate: OVERAGE_RATE_ILS_PER_MIN, overageAmount: 0 },
    ],
  });
  // Over the pool: overage at the ILS rate, whatever the account's currency.
  const over = usageByProduct(input({ planMinutes: 10, currency: "EUR", calls: [{ durationSeconds: min(25), product: null, createdAt: IN }] }));
  assert.deepEqual(over.entries[0], {
    entry: "pool",
    usedSeconds: min(25),
    usedMinutes: 25,
    includedMinutes: 10,
    overageMinutes: 15,
    overageRate: OVERAGE_RATE_ILS_PER_MIN,
    overageAmount: Math.round(15 * OVERAGE_RATE_ILS_PER_MIN * 100) / 100,
  });
  assert.equal(over.currency, "ILS");
  // An invalid record is grandfathered too.
  const bad = entitledProducts({ subscriptionPlan: "global", subscriptionStatus: "active", products: { base: "gold", addons: [] } });
  assert.equal(usageByProduct(input({ entitlement: bad })).kind, "pool");
  // A trial too.
  const trial = entitledProducts({ subscriptionPlan: "premium", subscriptionStatus: "trialing", products: null });
  assert.equal(usageByProduct(input({ entitlement: trial })).kind, "pool");
}
console.log("ok: grandfathered = today's single pool");

// ── Record-holders: per entry, no pool ───────────────────────────────────
type Row = [string, UsageByProductInput, unknown];
const e = (entry: string, owned: boolean, products: string[], usedSeconds: number, includedMinutes: number, overageRate: number) => {
  const usedMinutes = Math.round(usedSeconds / 60);
  const overageMinutes = Math.max(0, usedMinutes - includedMinutes);
  return { entry, owned, products, usedSeconds, usedMinutes, includedMinutes, overageMinutes, overageRate, overageAmount: Math.round(overageMinutes * overageRate * 100) / 100 };
};
const rows: Row[] = [
  [
    "reception only, under",
    input({ entitlement: rec("reception"), calls: [{ durationSeconds: min(50), product: null, createdAt: IN }] }),
    { kind: "products", currency: "EUR", entries: [e("reception", true, ["reception"], min(50), 200, 0.39)] },
  ],
  [
    "reception only, nothing used: the owned entry still shows",
    input({ entitlement: rec("reception") }),
    { kind: "products", currency: "EUR", entries: [e("reception", true, ["reception"], 0, 200, 0.39)] },
  ],
  [
    "reception_multi + sales, ILS: sales ILS minutes and rate differ from EUR",
    input({
      currency: "ILS",
      entitlement: rec("reception_multi", ["sales"]),
      calls: [{ durationSeconds: min(460), product: null, createdAt: IN }],
      campaignCalls: [{ durationSeconds: min(300), createdAt: IN }],
    }),
    { kind: "products", currency: "ILS", entries: [e("reception", true, ["reception_multi"], min(460), 450, 1.5), e("sales", true, ["sales"], min(300), 250, 1.9)] },
  ],
  [
    "NO shared pool: unused sales minutes do not cover reception overage",
    input({
      entitlement: rec("reception", ["sales"]),
      calls: [{ durationSeconds: min(260), product: null, createdAt: IN }],
    }),
    { kind: "products", currency: "EUR", entries: [e("reception", true, ["reception"], min(260), 200, 0.39), e("sales", true, ["sales"], 0, 400, 0.39)] },
  ],
  [
    "two products on one entry: minutes summed, the base's rate",
    input({
      entitlement: rec("reception_multi", ["reception"]),
      calls: [{ durationSeconds: min(700), product: "reception", createdAt: IN }],
    }),
    { kind: "products", currency: "EUR", entries: [e("reception", true, ["reception_multi", "reception"], min(700), 650, 0.39)] },
  ],
  [
    "connect calls count on connect; window bounds inclusive",
    input({
      entitlement: rec("connect"),
      calls: [
        { durationSeconds: min(10), product: "connect", createdAt: W.start },
        { durationSeconds: min(10), product: "connect", createdAt: W.end },
        { durationSeconds: min(10), product: "connect", createdAt: BEFORE },
      ],
    }),
    { kind: "products", currency: "EUR", entries: [e("connect", true, ["connect"], min(20), 100, 0.39)] },
  ],
  [
    "usage on an unowned entry shows, 0 included, its own rate",
    input({
      currency: "ILS",
      entitlement: rec("sales"),
      calls: [{ durationSeconds: min(3), product: null, createdAt: IN }],
    }),
    { kind: "products", currency: "ILS", entries: [e("reception", false, [], min(3), 0, 1.5), e("sales", true, ["sales"], 0, 250, 1.9)] },
  ],
  [
    "bad durations count as 0",
    input({ entitlement: rec("reception"), calls: [{ durationSeconds: Number.NaN, product: null, createdAt: IN }, { durationSeconds: -5, product: null, createdAt: IN }] }),
    { kind: "products", currency: "EUR", entries: [e("reception", true, ["reception"], 0, 200, 0.39)] },
  ],
];
for (const [name, inp, want] of rows) assert.deepEqual(usageByProduct(inp), want, name);
// An edited catalogue is honoured.
{
  const edited = structuredClone(cat);
  edited.reception.EUR.minutes = 10;
  edited.reception.EUR.overagePerMin = 2;
  const r = usageByProduct(input({ catalogue: edited, entitlement: rec("reception"), calls: [{ durationSeconds: min(13), product: null, createdAt: IN }] }));
  assert.deepEqual(r.entries[0], e("reception", true, ["reception"], min(13), 10, 2));
  assert.equal((r.entries[0] as { overageAmount: number }).overageAmount, 6);
}
console.log(`ok: record-holders per entry (${rows.length + 1} rows)`);


// ── Sign-up trial cap: trialing / trial_paused / active × product trials ─
// While the sign-up trial gate applies, the reception entry carries the
// trial cap (TRIAL_MINUTES_INCLUDED, the gate's all-time count, no overage)
// and a `signupTrial` field; no entry has overage. Per-product trials keep
// their own caps. A paid account is exactly as before.
{
  const ENDS = new Date("2026-11-20T00:00:00Z");
  const gateSeconds = min(130); // all-time count, above the 100-min cap
  const periodCalls = [
    { durationSeconds: min(40), product: null, createdAt: IN },
    { durationSeconds: min(9999), product: null, createdAt: BEFORE }, // outside the period, inside the gate count
    { durationSeconds: min(5), product: "connect", createdAt: IN },
  ];
  const campaignCalls = [{ durationSeconds: min(300), createdAt: IN }];
  const ent = rec("reception_multi");
  const productTrialRows = [{ product: "sales", startedAt: new Date("2026-11-05T00:00:00Z"), endsAt: new Date("2026-11-19T00:00:00Z"), minutesIncluded: 30 }];
  const compose = (status: string, withTrials: boolean, role: string | null = "user") => {
    const usage = usageByProduct(
      input({
        entitlement: ent,
        calls: periodCalls,
        campaignCalls,
        ...(signupTrialGateApplies({ subscriptionStatus: status, role }) ? { signupTrial: { endsAt: ENDS, secondsUsed: gateSeconds } } : {}),
      }),
    );
    return withTrials && usage.kind === "products" ? { ...usage, trials: trialUsage(productTrialRows, periodCalls, campaignCalls, IN) } : usage;
  };
  const rc = cat.reception_multi.EUR;
  const trialReception = {
    entry: "reception",
    owned: true,
    products: ["reception_multi"],
    usedSeconds: gateSeconds,
    usedMinutes: 130,
    includedMinutes: TRIAL_MINUTES_INCLUDED,
    overageMinutes: 0,
    overageRate: rc.overagePerMin,
    overageAmount: 0,
    signupTrial: { endsAt: ENDS.toISOString(), minutesIncluded: TRIAL_MINUTES_INCLUDED, usedMinutes: 130 },
  };
  const noOverage = (x: ReturnType<typeof e>) => ({ ...x, overageMinutes: 0, overageAmount: 0 });
  const trialEntries = [
    trialReception,
    noOverage(e("sales", false, [], min(300), 0, cat.sales.EUR.overagePerMin)),
    noOverage(e("connect", false, [], min(5), 0, cat.connect.EUR.overagePerMin)),
  ];
  const paidEntries = [
    e("reception", true, ["reception_multi"], min(40), rc.minutes, rc.overagePerMin),
    e("sales", false, [], min(300), 0, cat.sales.EUR.overagePerMin),
    e("connect", false, [], min(5), 0, cat.connect.EUR.overagePerMin),
  ];
  assert.equal(TRIAL_MINUTES_INCLUDED, 100);
  for (const status of ["trialing", "trial_paused", "active"]) {
    for (const withTrials of [false, true]) {
      const got = compose(status, withTrials) as { kind: string; entries: unknown[]; trials?: Array<Record<string, unknown>> };
      const label = `${status}, ${withTrials ? "with" : "without"} product trials`;
      assert.equal(got.kind, "products", label);
      assert.deepEqual(got.entries, status === "active" ? paidEntries : trialEntries, label);
      if (withTrials) {
        assert.equal(got.trials?.length, 1, label);
        assert.deepEqual([got.trials![0].product, got.trials![0].minutesIncluded], ["sales", 30], `${label}: the product trial keeps its own cap`);
      } else assert.ok(!("trials" in got), label);
    }
  }
  // Active: byte-identical to an input without signupTrial at all.
  assert.equal(JSON.stringify(compose("active", false)), JSON.stringify(usageByProduct(input({ entitlement: ent, calls: periodCalls, campaignCalls }))));
  // Admins are never gated, so never shown the trial cap.
  assert.deepEqual(compose("trialing", false, "admin").entries, paidEntries, "admin trialing: the catalogue, as the gate never applies");
  // The reception entry shows even when the account owns no reception product.
  const salesOnly = usageByProduct(input({ entitlement: rec("sales"), signupTrial: { endsAt: null, secondsUsed: 0 } }));
  assert.deepEqual((salesOnly.entries as Array<Record<string, unknown>>).map((x) => [x.entry, x.owned, x.includedMinutes, (x.signupTrial as { endsAt: unknown } | undefined)?.endsAt]), [
    ["reception", false, TRIAL_MINUTES_INCLUDED, null],
    ["sales", true, cat.sales.EUR.minutes, undefined],
  ]);
  // Grandfathered: signupTrial is ignored, the pool is unchanged.
  const gfIn = input({ calls: periodCalls, campaignCalls });
  assert.deepEqual(usageByProduct({ ...gfIn, signupTrial: { endsAt: ENDS, secondsUsed: gateSeconds } }), usageByProduct(gfIn), "grandfathered ignores signupTrial");
  console.log("ok: sign-up trial cap table (trialing / trial_paused / active × product trials, admin, no reception, grandfathered)");
}

const src = readFileSync(new URL("../../lib/usage-by-product.ts", import.meta.url), "utf8");
assert.doesNotMatch(src, /^import (?!type).*from "(@\/lib\/db|@\/lib\/products"|\.\/products")/m, "usage-by-product stays pure");
for (const m of src.matchAll(/^import .* from "([^"]+)";$/gm)) {
  // P3: ./product-trials is pure too (its own guard: scripts/tests/product-trials.test.ts), and imported for a type only.
  if (m[1] === "./product-trials") assert.match(m[0], /^import type /, "./product-trials is a type-only import");
  else assert.match(m[1], /^\.\/(product-catalogue|product-entitlement|product-values|trial)$/, `pure import ${m[1]}`);
}
console.log("ALL USAGE BY PRODUCT TESTS PASSED");
