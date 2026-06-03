// Unit tests for the PURE billing logic.
//
// No test framework is installed — plain tsx + node:assert/strict.
// Run with:  npx tsx scripts/tests/billing.test.ts
// Exits non-zero on the first failing assertion, printing the failing case.
//
// NOTE: tsx does not resolve the "@/" path alias, so we import via relative
// paths. lib/hyp.ts reads process.env lazily inside functions, so importing it
// is safe as long as we only touch the PURE exports (currencyForLocale /
// pageLangFor) and never call createPaymentUrl / verifyPayment (network).

import assert from "node:assert/strict";

import { currencyForLocale, pageLangFor } from "../../lib/hyp";
import { priceFor } from "../../lib/billing-pricing";
import { addPeriod, nextPaidUntil, validateHypReturn } from "../../lib/billing-activation";

let passed = 0;
const failures: string[] = [];

function group(label: string, fn: () => void): void {
  try {
    fn();
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`[${label}] ${msg}`);
  }
}

// 1) currencyForLocale
group("currencyForLocale", () => {
  assert.strictEqual(currencyForLocale("he"), "ILS");
  assert.strictEqual(currencyForLocale("fr"), "EUR");
  assert.strictEqual(currencyForLocale("en"), "EUR");
});

// 2) pageLangFor
group("pageLangFor", () => {
  assert.strictEqual(pageLangFor("he"), "HEB");
  assert.strictEqual(pageLangFor("fr"), "ENG");
  assert.strictEqual(pageLangFor("en"), "ENG");
});

// 3) priceFor EUR
group("priceFor EUR", () => {
  assert.strictEqual(priceFor("whatsapp", "monthly", "EUR"), 59);
  assert.strictEqual(priceFor("whatsapp", "annual", "EUR"), 588);
  assert.strictEqual(priceFor("global", "monthly", "EUR"), 129);
  assert.strictEqual(priceFor("global", "annual", "EUR"), 1284);
  assert.strictEqual(priceFor("premium", "monthly", "EUR"), 299);
  assert.strictEqual(priceFor("premium", "annual", "EUR"), 2988);
});

// 4) priceFor ILS — positive finite, monthly < annual for every plan
group("priceFor ILS", () => {
  for (const plan of ["whatsapp", "global", "premium"] as const) {
    const monthly = priceFor(plan, "monthly", "ILS");
    const annual = priceFor(plan, "annual", "ILS");
    assert.ok(
      Number.isFinite(monthly) && monthly > 0,
      `${plan} ILS monthly should be a positive finite number, got ${monthly}`,
    );
    assert.ok(
      Number.isFinite(annual) && annual > 0,
      `${plan} ILS annual should be a positive finite number, got ${annual}`,
    );
    assert.ok(
      monthly < annual,
      `${plan} ILS monthly (${monthly}) should be < annual (${annual})`,
    );
  }
});

// 5) addPeriod
group("addPeriod", () => {
  const base = new Date("2026-01-15T00:00:00Z");

  const monthly = addPeriod(base, "monthly");
  assert.strictEqual(monthly.getUTCFullYear(), 2026);
  assert.strictEqual(monthly.getUTCMonth(), 1); // February (0-indexed)
  assert.strictEqual(monthly.getUTCDate(), 15);

  const annual = addPeriod(base, "annual");
  assert.strictEqual(annual.getUTCFullYear(), 2027);
  assert.strictEqual(annual.getUTCMonth(), 0); // January
  assert.strictEqual(annual.getUTCDate(), 15);
});

// 6) nextPaidUntil
group("nextPaidUntil", () => {
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;

  // current in the FUTURE -> stack on top of current
  const future = new Date(now.getTime() + 10 * dayMs);
  assert.strictEqual(
    nextPaidUntil(future, now, "monthly").getTime(),
    addPeriod(future, "monthly").getTime(),
    "future paidUntil should stack from current",
  );

  // current null -> from now
  assert.strictEqual(
    nextPaidUntil(null, now, "monthly").getTime(),
    addPeriod(now, "monthly").getTime(),
    "null paidUntil should restart from now",
  );

  // current in the PAST -> restart from now
  const past = new Date(now.getTime() - 10 * dayMs);
  assert.strictEqual(
    nextPaidUntil(past, now, "monthly").getTime(),
    addPeriod(now, "monthly").getTime(),
    "past paidUntil should restart from now",
  );
});

// 7) validateHypReturn
group("validateHypReturn", () => {
  const now = new Date("2026-06-03T12:00:00Z");
  const futureExpiry = new Date(now.getTime() + 30 * 60 * 1000);

  const baseOrder = {
    expectedAmount: 129,
    coin: "3",
    status: "pending",
    expiresAt: futureExpiry,
  };

  // exact amount with decimals
  {
    const r = validateHypReturn(baseOrder, { Amount: "129.00", Coin: "3" }, now);
    assert.strictEqual(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
  }

  // numeric compare (no decimals)
  {
    const r = validateHypReturn(baseOrder, { Amount: "129", Coin: "3" }, now);
    assert.strictEqual(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
  }

  // amount mismatch
  {
    const r = validateHypReturn(baseOrder, { Amount: "5.00", Coin: "3" }, now);
    assert.strictEqual(r.ok, false);
    assert.ok(
      r.reason?.startsWith("amount_mismatch"),
      `expected amount_mismatch reason, got ${r.reason}`,
    );
  }

  // coin mismatch
  {
    const r = validateHypReturn(baseOrder, { Amount: "129.00", Coin: "1" }, now);
    assert.strictEqual(r.ok, false);
    assert.ok(
      r.reason?.startsWith("coin_mismatch"),
      `expected coin_mismatch reason, got ${r.reason}`,
    );
  }

  // already paid -> ok + idempotent reason
  {
    const r = validateHypReturn(
      { ...baseOrder, status: "paid" },
      { Amount: "129.00", Coin: "3" },
      now,
    );
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.reason, "already_paid");
  }

  // expired
  {
    const pastExpiry = new Date(now.getTime() - 60 * 1000);
    const r = validateHypReturn(
      { ...baseOrder, expiresAt: pastExpiry },
      { Amount: "129.00", Coin: "3" },
      now,
    );
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "expired");
  }
});

// Summary
if (failures.length > 0) {
  console.error(`\n${failures.length} TEST GROUP(S) FAILED:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

console.log(`ALL ${passed} TESTS PASSED`);
