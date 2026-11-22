// Order terms snapshot (lib/order-terms.ts), pure parts, as tables:
//   1. parseLineTerms (strict) and the read-back of lines carrying terms
//      (parseOrderLines keeps them; invoiceLines / withoutTerms drop them);
//   2. termsFor: a covering paid order with terms, none, an old order
//      without terms (live fallback), boundaries, annual sub-periods
//      (monthlySubPeriods: every month of an annual order reads its terms);
//   3. pinnedCatalogue: minutes always pinned, the rate only in its currency;
//   4. a catalogue edit AFTER a payment changes nothing for that paid period
//      (usageByProduct display numbers, warning thresholds), and applies to
//      the next one;
//   5. overage of a finished period at THAT period's pinned rate and minutes
//      (computeOverageLines), never at the new catalogue's; cross-currency:
//      pinned minutes, the new order's currency's live rate;
//   6. termsChanges: first order [], price / minutes / rate / currency
//      changes, add-on added / removed; previousPaidOrder.
// Mock data only. Run with:  npx tsx scripts/tests/order-terms.test.ts

import assert from "node:assert/strict";

import { monthlySubPeriods } from "../../lib/monthly-periods";
import { DEFAULT_PRODUCT_CATALOGUE, defaultProductCatalogue, type ProductCatalogue } from "../../lib/product-catalogue";
import { catalogueLines, computeOverageLines, invoiceLines, parseOrderLines, withoutTerms, type OrderLine, type PaidCoverage } from "../../lib/order-lines";
import {
  linesTerms,
  orderCovering,
  parseLineTerms,
  pinnedCatalogue,
  previousPaidOrder,
  termsAt,
  termsChanges,
  termsFor,
  type LineTerms,
} from "../../lib/order-terms";
import { thresholdsCrossed } from "../../lib/usage-warnings";
import { usageByProduct } from "../../lib/usage-by-product";

const d = (s: string) => new Date(s);
const live = DEFAULT_PRODUCT_CATALOGUE;
const T = (price: number, includedMinutes: number, overageRate: number, currency: "EUR" | "ILS" = "EUR"): LineTerms => ({ price, includedMinutes, overageRate, currency });

/** A paid order's lines: catalogueLines at `cat`, then the period it paid. */
function paidOrder(cat: ProductCatalogue, start: string, end: string, opts: { period?: "monthly" | "annual"; addons?: ("sales" | "connect")[]; currency?: "EUR" | "ILS" } = {}): OrderLine[] {
  const lines: OrderLine[] = catalogueLines({ base: "reception", addons: opts.addons ?? [] }, opts.period ?? "monthly", opts.currency ?? "EUR", cat);
  const b = lines[0];
  if (b.kind !== "base") throw new Error("no base");
  lines[0] = { ...b, periodStart: d(start).toISOString(), periodEnd: d(end).toISOString() };
  return lines;
}

// ── 1. parse + read-back ──────────────────────────────────────────────
{
  assert.deepEqual(parseLineTerms({ price: 89, includedMinutes: 200, overageRate: 0.39, currency: "EUR" }), T(89, 200, 0.39));
  for (const bad of [
    null,
    [],
    "x",
    { price: 89, includedMinutes: 200, overageRate: 0.39 },
    { price: 89, includedMinutes: 200, overageRate: 0.39, currency: "USD" },
    { price: -1, includedMinutes: 200, overageRate: 0.39, currency: "EUR" },
    { price: 89, includedMinutes: "200", overageRate: 0.39, currency: "EUR" },
    { price: 89, includedMinutes: 200, overageRate: 0.39, currency: "EUR", extra: 1 },
  ])
    assert.equal(parseLineTerms(bad), null, JSON.stringify(bad));
  const lines = paidOrder(live, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", { addons: ["sales"] });
  lines.push({ kind: "overage", entry: "reception", periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-10-01T00:00:00.000Z", minutes: 5, amount: 1.95 });
  assert.deepEqual(parseOrderLines(JSON.parse(JSON.stringify(lines))), lines, "terms survive the jsonb round trip");
  // Bad terms make the whole order unreadable (strict, as every other field).
  const withBad = JSON.parse(JSON.stringify(lines));
  withBad[1].terms.currency = "USD";
  assert.equal(parseOrderLines(withBad), null);
  const overageWithTerms = JSON.parse(JSON.stringify(lines));
  overageWithTerms[2].terms = T(1, 1, 1);
  assert.equal(parseOrderLines(overageWithTerms), null, "terms on an overage line are refused");
  // An order before the snapshot (no terms) reads as before.
  const old = [{ kind: "base", product: "reception", period: "monthly", amount: 89 }];
  assert.deepEqual(parseOrderLines(old), old);
  // The P4 `lines` shape (billing-stats invoices) never shows the terms.
  const inv = invoiceLines(lines).lines!;
  assert.ok(inv.every((l) => !("terms" in l)));
  assert.deepEqual(inv, withoutTerms(lines));
  assert.deepEqual(inv[0], { kind: "base", product: "reception", period: "monthly", amount: 89, periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-11-01T00:00:00.000Z" });
}

// ── 2. termsFor ───────────────────────────────────────────────────────
{
  const edited = defaultProductCatalogue();
  edited.reception.EUR.minutes = 100;
  edited.reception.EUR.overagePerMin = 0.99;
  // Paid at the default catalogue (200 min, 0.39); the catalogue was edited since.
  const OCT = { lines: paidOrder(live, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z") };
  const OLD = { lines: [{ kind: "base", product: "reception", period: "monthly", amount: 89, periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-09-01T00:00:00.000Z" }] as OrderLine[] };
  const YEAR = { lines: paidOrder(live, "2025-01-15T00:00:00Z", "2026-01-15T00:00:00Z", { period: "annual" }) };
  const orders = [OCT, OLD, YEAR];
  const ctx = { catalogue: edited, currency: "EUR" as const };
  type Row = [string, Date, LineTerms];
  const table: Row[] = [
    ["paid order covering → its pinned terms", d("2026-10-10T00:00:00Z"), T(89, 200, 0.39)],
    ["the period's first instant is covered", d("2026-10-01T00:00:00Z"), T(89, 200, 0.39)],
    ["the period's end is not (the next one starts there) → live", d("2026-11-01T00:00:00Z"), T(89, 100, 0.99)],
    ["no paid order covering → live catalogue", d("2026-12-10T00:00:00Z"), T(89, 100, 0.99)],
    ["an old order without terms → live catalogue", d("2026-08-10T00:00:00Z"), T(89, 100, 0.99)],
    ["annual order → its pinned terms (annual price, monthly minutes)", d("2025-06-01T00:00:00Z"), T(890, 200, 0.39)],
  ];
  for (const [name, at, want] of table) assert.deepEqual(termsFor(orders, "reception", at, ctx), want, name);
  // A product the covering order does not carry → live.
  assert.deepEqual(termsFor(orders, "sales", d("2026-10-10T00:00:00Z"), ctx), T(edited.sales.EUR.monthly, edited.sales.EUR.minutes, edited.sales.EUR.overagePerMin));
  // Every monthly sub-period of the annual order reads the annual order's terms.
  const subs = monthlySubPeriods(d("2025-01-15T00:00:00Z"), d("2026-01-15T00:00:00Z"));
  assert.equal(subs.length, 12);
  for (const s of subs) {
    assert.deepEqual(termsFor(orders, "reception", s.start, ctx), T(890, 200, 0.39), `sub-period ${s.start.toISOString()}`);
    assert.deepEqual(termsFor(orders, "reception", new Date(s.end.getTime() - 1), ctx), T(890, 200, 0.39));
  }
  assert.equal(orderCovering(orders, d("2027-01-01T00:00:00Z")), null);
  // termsAt: now clamped into [start, end).
  const w = { start: d("2026-10-01T00:00:00Z"), end: d("2026-11-01T00:00:00Z") };
  assert.equal(termsAt(w, d("2026-10-05T00:00:00Z")).toISOString(), "2026-10-05T00:00:00.000Z");
  assert.equal(termsAt(w, d("2026-12-05T00:00:00Z")).getTime(), w.end.getTime() - 1);
  assert.equal(termsAt(w, d("2026-09-05T00:00:00Z")).getTime(), w.start.getTime());
}

// ── 3. pinnedCatalogue ────────────────────────────────────────────────
{
  const edited = defaultProductCatalogue();
  edited.reception.EUR.minutes = 100;
  edited.reception.EUR.overagePerMin = 0.99;
  edited.reception.ILS.minutes = 120;
  edited.reception.ILS.overagePerMin = 2.5;
  const orders = [{ lines: paidOrder(live, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z") }];
  const at = d("2026-10-10T00:00:00Z");
  const eur = pinnedCatalogue(edited, orders, at, "EUR");
  assert.equal(eur.reception.EUR.minutes, 200);
  assert.equal(eur.reception.EUR.overagePerMin, 0.39);
  assert.equal(eur.reception.EUR.monthly, edited.reception.EUR.monthly, "prices are not touched");
  // Read in ILS: the pinned (EUR) minutes, ILS's live rate (no exchange rate).
  const ils = pinnedCatalogue(edited, orders, at, "ILS");
  assert.equal(ils.reception.ILS.minutes, 200);
  assert.equal(ils.reception.ILS.overagePerMin, 2.5);
  // Nothing covering → values identical to the live catalogue; input untouched.
  assert.deepEqual(pinnedCatalogue(edited, orders, d("2026-12-10T00:00:00Z"), "EUR"), edited);
  assert.deepEqual(pinnedCatalogue(edited, [], at, "ILS"), edited);
  assert.equal(edited.reception.EUR.minutes, 100);
}

// ── 4. an edit after the payment: no change for the paid period ───────
{
  const orders = [{ lines: paidOrder(live, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z") }];
  const window = { start: d("2026-10-01T00:00:00Z"), end: d("2026-11-01T00:00:00Z") };
  const calls = [{ durationSeconds: 170 * 60, product: null, createdAt: d("2026-10-10T00:00:00Z") }];
  const view = (cat: ProductCatalogue, at: Date) =>
    usageByProduct({
      calls,
      campaignCalls: [],
      window,
      entitlement: { base: "reception", addons: [], entries: [], source: "products" },
      catalogue: pinnedCatalogue(cat, orders, at, "EUR"),
      currency: "EUR",
      planMinutes: 0,
      planOverage: 0,
    });
  const at = termsAt(window, d("2026-10-20T00:00:00Z"));
  const before = view(live, at);
  const edited = defaultProductCatalogue();
  edited.reception.EUR.minutes = 100;
  edited.reception.EUR.overagePerMin = 0.99;
  const after = view(edited, at);
  assert.deepEqual(after, before, "a catalogue edit after the payment changed that period's usage numbers");
  const e = after.kind === "products" ? after.entries[0] : null;
  assert.deepEqual(
    { included: e?.includedMinutes, rate: e?.overageRate, overage: e?.overageMinutes },
    { included: 200, rate: 0.39, overage: 0 },
  );
  // The warning thresholds: 170 of the pinned 200 = 85 % → 80 only (the edited 100 would say 100).
  assert.deepEqual(thresholdsCrossed(e!.usedSeconds, e!.includedMinutes), [80]);
  assert.deepEqual(thresholdsCrossed(170 * 60, edited.reception.EUR.minutes), [80, 100]);
  // The next period (no paid order yet): the edited catalogue applies.
  const next = view(edited, d("2026-11-10T00:00:00Z"));
  assert.equal(next.kind === "products" ? next.entries[0].includedMinutes : -1, 100);
}

// ── 5. overage of a finished period at ITS pinned terms ───────────────
{
  const OCT: PaidCoverage = { start: d("2026-10-01T00:00:00Z"), end: d("2026-11-01T00:00:00Z"), period: "monthly", base: "reception", addons: ["sales"] };
  const paid = [{ lines: paidOrder(live, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", { addons: ["sales"] }) }];
  // Edited between the period and the next payment: fewer minutes, dearer.
  const edited = defaultProductCatalogue();
  edited.reception.EUR.minutes = 100;
  edited.reception.EUR.overagePerMin = 0.99;
  edited.sales.EUR.overagePerMin = 0.99;
  edited.reception.ILS.overagePerMin = 2.5;
  const input = (over: Partial<Parameters<typeof computeOverageLines>[0]> = {}) => ({
    coverages: [OCT],
    calls: [
      { durationSeconds: 250 * 60, product: null, createdAt: d("2026-10-10T00:00:00Z") },
      { durationSeconds: 410 * 60, product: "sales", createdAt: d("2026-10-11T00:00:00Z") },
    ],
    campaignCalls: [],
    catalogue: edited,
    currency: "EUR" as const,
    billed: new Set<string>(),
    now: d("2026-11-15T00:00:00Z"),
    paidOrders: paid,
    ...over,
  });
  const pick = (ls: ReturnType<typeof computeOverageLines>) => ls.map((l) => [l.entry, l.minutes, l.amount]);
  // Pinned: reception 200 min at 0.39 → 50 × 0.39; sales 400 min at 0.39 → 10 × 0.39.
  assert.deepEqual(pick(computeOverageLines(input())), [
    ["reception", 50, 19.5],
    ["sales", 10, 3.9],
  ]);
  // Without the snapshot (P4 as it was): the edited catalogue would bill 150 × 0.99.
  assert.deepEqual(pick(computeOverageLines(input({ paidOrders: undefined }))), [
    ["reception", 150, 148.5],
    ["sales", 10, 9.9],
  ]);
  // An old paid order without terms: the live catalogue, exactly as P4.
  const oldPaid = [{ lines: withoutTerms(paid[0].lines) }];
  assert.deepEqual(pick(computeOverageLines(input({ paidOrders: oldPaid }))), pick(computeOverageLines(input({ paidOrders: undefined }))));
  // The new order in ILS (P4: overage priced in the new order's currency):
  // the period's pinned minutes (200 / 400), ILS's live rate (2.5 / 1.9).
  assert.deepEqual(pick(computeOverageLines(input({ currency: "ILS" }))), [
    ["reception", 50, 125],
    ["sales", 10, 19],
  ]);
}

// ── 6. termsChanges ───────────────────────────────────────────────────
{
  const prevLines = catalogueLines({ base: "reception", addons: ["sales"] }, "monthly", "EUR", live);
  const prev = linesTerms(prevLines);
  assert.deepEqual(prev.map((t) => [t.kind, t.product]), [["base", "reception"], ["addon", "sales"]]);
  // First order: nothing to compare.
  assert.deepEqual(termsChanges(null, prev), []);
  // The same terms: no change.
  assert.deepEqual(termsChanges(prev, linesTerms(catalogueLines({ base: "reception", addons: ["sales"] }, "monthly", "EUR", live))), []);
  // A price change and a minutes change.
  const cat = defaultProductCatalogue();
  cat.reception.EUR.monthly = 99;
  cat.sales.EUR.minutes = 450;
  cat.sales.EUR.overagePerMin = 0.29;
  assert.deepEqual(termsChanges(prev, linesTerms(catalogueLines({ base: "reception", addons: ["sales"] }, "monthly", "EUR", cat))), [
    { product: "reception", field: "price", from: 89, to: 99 },
    { product: "sales", field: "includedMinutes", from: 400, to: 450 },
    { product: "sales", field: "overageRate", from: 0.39, to: 0.29 },
  ]);
  // Add-on added and removed.
  assert.deepEqual(termsChanges(prev, linesTerms(catalogueLines({ base: "reception", addons: ["connect"] }, "monthly", "EUR", live))), [
    { product: "connect", field: "added", from: null, to: T(39, 100, 0.39) },
    { product: "sales", field: "removed", from: T(99, 400, 0.39), to: null },
  ]);
  // Another currency: the currency change first, then the values as they are.
  const ilsChanges = termsChanges(prev.slice(0, 1), linesTerms(catalogueLines({ base: "reception", addons: [] }, "monthly", "ILS", live)));
  assert.deepEqual(ilsChanges, [
    { product: "reception", field: "currency", from: "EUR", to: "ILS" },
    { product: "reception", field: "price", from: 89, to: 349 },
    { product: "reception", field: "overageRate", from: 0.39, to: 1.5 },
  ]);
  // A previous order without terms: read from the fallback catalogue (its price = the amount paid).
  const oldPrev = linesTerms(withoutTerms(prevLines), { catalogue: live, currency: "EUR" });
  assert.deepEqual(oldPrev, prev);
  assert.deepEqual(linesTerms(withoutTerms(prevLines)), [], "no fallback → no terms");
  // previousPaidOrder: the latest paidAt.
  const a = { paidAt: d("2026-09-01T00:00:00Z"), n: 1 };
  const b = { paidAt: d("2026-10-01T00:00:00Z"), n: 2 };
  assert.equal(previousPaidOrder([a, b, { paidAt: null, n: 3 }])?.n, 2);
  assert.equal(previousPaidOrder([]), null);
}

console.log("order-terms: parse, termsFor (paid / none / old / annual), pinnedCatalogue, edit-after-payment, pinned overage, changes — all passed");
