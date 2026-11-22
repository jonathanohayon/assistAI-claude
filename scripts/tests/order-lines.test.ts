// Multi-line HYP orders (lib/order-lines.ts, P4), pure parts, as tables:
//   1. productPurchasable per flag, and planKeyForBase (reception → global,
//      reception_multi → premium, sales / connect → none: always refused as a
//      BASE, even with CAMPAIGN_DISPATCH=on and CLIENT_AGENT=all);
//   2. parseOrderSelection: every refusal (status + code) and the accepted shapes;
//   3. catalogueLines + orderTotal (EUR / ILS, monthly / annual = 10x, cents);
//   4. computeOverageLines: completed periods only, owned entries only,
//      never the same (entry, periodStart) twice, annual = 12 monthly periods,
//      boundary call billed once;
//   5. parseOrderLines / invoiceLines / selectionOf / orderInfo;
//   6. the order email (pure renderer): lines, overage minutes, escaping.
// Run with:  npx tsx scripts/tests/order-lines.test.ts

import assert from "node:assert/strict";

import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import he from "../../messages/he.json";
import { DEFAULT_PRODUCT_CATALOGUE } from "../../lib/product-catalogue";
import { PRODUCTS, type Product } from "../../lib/product-values";
import {
  MAX_ORDER_AMOUNT,
  billedOverageKeys,
  billingPeriodsOf,
  catalogueLines,
  computeOverageLines,
  invoiceLines,
  orderInfo,
  orderTotal,
  parseOrderLines,
  parseOrderSelection,
  planKeyForBase,
  productPurchasable,
  selectionOf,
  type OrderLine,
  type OverageInput,
  type PaidCoverage,
} from "../../lib/order-lines";
import { formatOrderAmount, renderOrderConfirmationEmail, type OrderEmailKey } from "../../lib/order-email";

const cat = DEFAULT_PRODUCT_CATALOGUE;
const OFF = {};
const ALL_ON = { CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" };

// ── 1. purchasable + plan key ─────────────────────────────────────────
{
  const table: Array<[Product, Record<string, string>, boolean]> = [
    ["reception", OFF, true],
    ["reception_multi", OFF, true],
    ["sales", OFF, false],
    ["sales", { CAMPAIGN_DISPATCH: "dry" }, false],
    ["sales", { CAMPAIGN_DISPATCH: " ON " }, true],
    ["connect", OFF, false],
    ["connect", { CLIENT_AGENT: "admin" }, false],
    ["connect", { CLIENT_AGENT: "all" }, true],
  ];
  for (const [p, env, want] of table) assert.equal(productPurchasable(p, env), want, `${p} ${JSON.stringify(env)}`);
  assert.equal(planKeyForBase("reception"), "global");
  assert.equal(planKeyForBase("reception_multi"), "premium");
  assert.equal(planKeyForBase("sales"), null);
  assert.equal(planKeyForBase("connect"), null);
}

// ── 2. parseOrderSelection ────────────────────────────────────────────
{
  const ok = (raw: unknown, env: Record<string, string> = OFF) => {
    const r = parseOrderSelection(raw, env);
    assert.ok(r.ok, JSON.stringify(raw));
    return r.selection;
  };
  const no = (raw: unknown, status: number, error: string, env: Record<string, string> = OFF) => {
    const r = parseOrderSelection(raw, env);
    assert.deepEqual(r, { ok: false, status, error }, JSON.stringify(raw));
  };
  assert.deepEqual(ok({ base: "reception", addons: [] }), { base: "reception", addons: [] });
  assert.deepEqual(ok({ addons: [], base: "reception_multi" }), { base: "reception_multi", addons: [] });
  assert.deepEqual(ok({ base: "reception", addons: ["sales", "connect"] }, ALL_ON), { base: "reception", addons: ["sales", "connect"] });
  // Shape.
  for (const raw of [null, undefined, "reception", [], {}, { base: "reception" }, { base: "reception", addons: "sales" }, { base: "reception", addons: [], amount: 1 }])
    no(raw, 400, "invalid_products");
  // Unknown products.
  no({ base: "pool", addons: [] }, 400, "unknown_product");
  no({ base: "reception", addons: ["sms"] }, 400, "unknown_product");
  no({ base: "reception", addons: [1] }, 400, "unknown_product");
  // Duplicates, base in add-ons, reception_multi as an add-on.
  no({ base: "reception", addons: ["sales", "sales"] }, 400, "duplicate_addon", ALL_ON);
  no({ base: "reception", addons: ["reception"] }, 400, "base_in_addons");
  no({ base: "reception", addons: ["reception_multi"] }, 400, "addon_not_sold");
  // Unpurchasable add-ons (flags off), allowed once on.
  no({ base: "reception", addons: ["sales"] }, 409, "product_unavailable");
  no({ base: "reception", addons: ["connect"] }, 409, "product_unavailable", { CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "admin" });
  // A sales / connect BASE: ALWAYS refused, whatever the flags.
  for (const env of [OFF, ALL_ON]) {
    no({ base: "sales", addons: [] }, 409, "product_unavailable", env);
    no({ base: "connect", addons: [] }, 409, "product_unavailable", env);
    no({ base: "sales", addons: ["reception"] }, 409, "product_unavailable", env);
  }
}

// ── 3. lines + total ──────────────────────────────────────────────────
{
  assert.deepEqual(catalogueLines({ base: "reception", addons: [] }, "monthly", "EUR", cat), [
    { kind: "base", product: "reception", period: "monthly", amount: 89 },
  ]);
  assert.deepEqual(catalogueLines({ base: "reception_multi", addons: ["sales", "connect"] }, "annual", "ILS", cat), [
    { kind: "base", product: "reception_multi", period: "annual", amount: 6490 },
    { kind: "addon", product: "sales", period: "annual", amount: 3990 },
    { kind: "addon", product: "connect", period: "annual", amount: 1490 },
  ]);
  assert.equal(orderTotal(catalogueLines({ base: "reception_multi", addons: ["sales", "connect"] }, "annual", "ILS", cat)), 11970);
  for (const p of PRODUCTS) for (const c of ["EUR", "ILS"] as const) assert.equal(cat[p][c].annual, cat[p][c].monthly * 10);
  // Integer cents: 0.1 + 0.2 style drift never reaches the total.
  const odd: OrderLine[] = [
    { kind: "base", product: "reception", period: "monthly", amount: 89 },
    { kind: "overage", entry: "reception", periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-11-01T00:00:00.000Z", minutes: 1, amount: 0.1 },
    { kind: "overage", entry: "sales", periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-11-01T00:00:00.000Z", minutes: 1, amount: 0.2 },
  ];
  assert.equal(orderTotal(odd), 89.3);
  assert.equal(orderTotal(odd).toFixed(2), "89.30");
  // The largest possible basket (every base + every add-on price, annual) stays
  // far below the float4 cent limit.
  for (const c of ["EUR", "ILS"] as const) {
    const max = cat.reception_multi[c].annual + cat.sales[c].addonAnnual! + cat.connect[c].addonAnnual! + cat.reception[c].addonAnnual!;
    assert.ok(max < MAX_ORDER_AMOUNT / 4, `${c} ${max}`);
  }
  // A float4 round trip keeps toFixed(2) below the limit.
  for (const v of [89, 89.3, 349.39, 11970.99, 65535]) assert.equal(Math.fround(v).toFixed(2), v.toFixed(2), String(v));
}

// ── 4. overage ────────────────────────────────────────────────────────
{
  const d = (s: string) => new Date(s);
  const OCT: PaidCoverage = { start: d("2026-10-01T00:00:00Z"), end: d("2026-11-01T00:00:00Z"), period: "monthly", base: "reception", addons: [] };
  const NOV: PaidCoverage = { start: d("2026-11-01T00:00:00Z"), end: d("2026-12-01T00:00:00Z"), period: "monthly", base: "reception", addons: [] };
  const min = (m: number) => m * 60;
  const call = (at: string, minutes: number, product: string | null = null) => ({ durationSeconds: min(minutes), product, createdAt: d(at) });
  const base = (over: Partial<OverageInput>): OverageInput => ({
    coverages: [OCT],
    calls: [],
    campaignCalls: [],
    catalogue: cat,
    currency: "EUR",
    billed: new Set(),
    now: d("2026-11-15T00:00:00Z"),
    ...over,
  });
  type Row = [string, Partial<OverageInput>, Array<[string, string, number, number]>];
  const table: Row[] = [
    ["no usage, no line", {}, []],
    ["within the 200 included", { calls: [call("2026-10-10T10:00:00Z", 200)] }, []],
    ["250 used on reception (200 incl.) → 50 min × 0.39", { calls: [call("2026-10-10T10:00:00Z", 250)] }, [["reception", "2026-10-01T00:00:00.000Z", 50, 19.5]]],
    ["ILS rate", { currency: "ILS", calls: [call("2026-10-10T10:00:00Z", 210)] }, [["reception", "2026-10-01T00:00:00.000Z", 10, 15]]],
    ["the running period (end > now) is not billed", { coverages: [NOV], calls: [call("2026-11-10T10:00:00Z", 999)] }, []],
    ["usage on an entry the coverage did not own (a trial) is not billed", { calls: [call("2026-10-10T10:00:00Z", 999, "connect")] }, []],
    [
      "an owned add-on entry is billed with its own rate",
      {
        coverages: [{ ...OCT, addons: ["sales"] }],
        calls: [call("2026-10-10T10:00:00Z", 450, "sales")],
        campaignCalls: [{ durationSeconds: min(10), createdAt: d("2026-10-11T10:00:00Z") }],
      },
      [["sales", "2026-10-01T00:00:00.000Z", 60, 23.4]],
    ],
    ["already billed (entry, periodStart) → nothing", { calls: [call("2026-10-10T10:00:00Z", 250)], billed: new Set(["reception|2026-10-01T00:00:00.000Z"]) }, []],
    ["billed on another entry does not hide this one", { calls: [call("2026-10-10T10:00:00Z", 250)], billed: new Set(["sales|2026-10-01T00:00:00.000Z"]) }, [["reception", "2026-10-01T00:00:00.000Z", 50, 19.5]]],
    [
      "a call exactly on the boundary belongs to the next period only",
      { coverages: [OCT, NOV], now: d("2026-12-02T00:00:00Z"), calls: [call("2026-11-01T00:00:00Z", 201)] },
      [["reception", "2026-11-01T00:00:00.000Z", 1, 0.39]],
    ],
    [
      "two completed periods, two lines, period order",
      { coverages: [NOV, OCT], now: d("2026-12-02T00:00:00Z"), calls: [call("2026-10-05T00:00:00Z", 201), call("2026-11-05T00:00:00Z", 202)] },
      [
        ["reception", "2026-10-01T00:00:00.000Z", 1, 0.39],
        ["reception", "2026-11-01T00:00:00.000Z", 2, 0.78],
      ],
    ],
    [
      "the same coverage twice (two paid rows) bills once",
      { coverages: [OCT, OCT], calls: [call("2026-10-10T10:00:00Z", 250)] },
      [["reception", "2026-10-01T00:00:00.000Z", 50, 19.5]],
    ],
  ];
  for (const [name, over, want] of table) {
    const got = computeOverageLines(base(over)).map((l) => [l.entry, l.periodStart, l.minutes, l.amount]);
    assert.deepEqual(got, want, name);
  }
  // Every line carries its period end.
  const [one] = computeOverageLines(base({ calls: [call("2026-10-10T10:00:00Z", 250)] }));
  assert.deepEqual(one, { kind: "overage", entry: "reception", periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-11-01T00:00:00.000Z", minutes: 50, amount: 19.5 });

  // Annual coverage = 12 monthly periods, each against the MONTHLY minutes.
  const YEAR: PaidCoverage = { start: d("2025-10-01T00:00:00Z"), end: d("2026-10-01T00:00:00Z"), period: "annual", base: "reception", addons: [] };
  const ps = billingPeriodsOf(YEAR);
  assert.equal(ps.length, 12);
  assert.equal(ps[0].start.toISOString(), "2025-10-01T00:00:00.000Z");
  assert.equal(ps[11].end.toISOString(), "2026-10-01T00:00:00.000Z");
  for (let i = 1; i < 12; i++) assert.equal(ps[i].start.getTime(), ps[i - 1].end.getTime());
  const annual = computeOverageLines(base({ coverages: [YEAR], now: d("2026-11-01T00:00:00Z"), calls: [call("2026-03-10T00:00:00Z", 210), call("2026-04-10T00:00:00Z", 190)] }));
  // addPeriod steps in the process's local time (as users.paidUntil does), so
  // the expected month start is read from the periods themselves.
  const march = ps.find((p) => p.start.getTime() <= d("2026-03-10T00:00:00Z").getTime() && d("2026-03-10T00:00:00Z").getTime() < p.end.getTime())!;
  assert.deepEqual(annual.map((l) => [l.periodStart, l.minutes]), [[march.start.toISOString(), 10]]);

  // billedOverageKeys reads overage lines only.
  assert.deepEqual(
    [...billedOverageKeys([[{ kind: "base", product: "reception", period: "monthly", amount: 89 }, one]])],
    ["reception|2026-10-01T00:00:00.000Z"],
  );
}

// ── 5. read-back, invoices, selection, Info ───────────────────────────
{
  const lines: OrderLine[] = [
    { kind: "base", product: "reception", period: "monthly", amount: 89 },
    { kind: "addon", product: "sales", period: "monthly", amount: 99 },
    { kind: "overage", entry: "reception", periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-11-01T00:00:00.000Z", minutes: 50, amount: 19.5 },
  ];
  assert.deepEqual(parseOrderLines(JSON.parse(JSON.stringify(lines))), lines);
  const paid = [{ ...lines[0], periodStart: "2026-11-01T00:00:00.000Z", periodEnd: "2026-12-01T00:00:00.000Z" }, ...lines.slice(1)];
  assert.deepEqual(parseOrderLines(paid), paid);
  for (const bad of [null, [], {}, [lines[1]], [lines[0], lines[0]], [lines[0], { ...lines[1], amount: -1 }], [{ ...lines[0], periodStart: "x", periodEnd: "y" }], [lines[0], { kind: "credit", amount: 5 }]])
    assert.equal(parseOrderLines(bad), null, JSON.stringify(bad));
  assert.deepEqual(invoiceLines(null), {});
  assert.deepEqual(invoiceLines(undefined), {});
  assert.deepEqual(invoiceLines(lines), { lines });
  assert.equal(Object.keys(invoiceLines(null)).length, 0);
  assert.deepEqual(selectionOf(lines), { base: "reception", addons: ["sales"] });
  assert.equal(orderInfo("fr", "Réceptionniste", lines), "Réceptionniste +1 option + dépassement (mensuel)");
  assert.equal(orderInfo("en", "Receptionist", [{ ...lines[0], period: "annual" }, lines[1], { ...lines[1], product: "connect" }]), "Receptionist +2 add-ons (annual)");
  assert.equal(orderInfo("he", "פקידת קבלה", [lines[0]]), "פקידת קבלה (חודשי)");
  assert.ok(orderInfo("fr", "x".repeat(300), lines).length <= 160);
}

// ── 6. order email (pure renderer, never sent) ────────────────────────
{
  const MSG = { fr, en, he } as const;
  const tFor = (loc: "fr" | "en" | "he") => (key: OrderEmailKey, vars?: Record<string, string | number>) => {
    let s = (MSG[loc].Email.subscriptionConfirmation as Record<string, string>)[key];
    assert.ok(typeof s === "string", `${loc} missing ${key}`);
    for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, String(v));
    return s;
  };
  const lines: OrderLine[] = [
    { kind: "base", product: "reception_multi", period: "monthly", amount: 169 },
    { kind: "addon", product: "connect", period: "monthly", amount: 39 },
    { kind: "overage", entry: "reception", periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-11-01T00:00:00.000Z", minutes: 50, amount: 19.5 },
  ];
  const fr1 = renderOrderConfirmationEmail({ lines, period: "monthly", amount: 227.5, currency: "EUR", locale: "fr" }, tFor("fr"));
  assert.equal(fr1.subject, fr.Email.subscriptionConfirmation.subject.replace("{plan}", "Clinique / Multi-sites"));
  assert.ok(fr1.text.includes("Clinique / Multi-sites — 169 €"), fr1.text);
  assert.ok(fr1.text.includes("Connecter votre agent (option) — 39 €"), fr1.text);
  assert.ok(fr1.text.includes("Dépassement Réception — 50 min — 19,50 €"), fr1.text);
  assert.ok(fr1.text.includes("227,50 €"), fr1.text);
  assert.ok(fr1.html.includes('dir="ltr"'));
  const he1 = renderOrderConfirmationEmail({ lines, period: "annual", amount: 227.5, currency: "ILS", locale: "he" }, tFor("he"));
  assert.ok(he1.html.includes('dir="rtl"'));
  assert.ok(he1.text.includes("₪"));
  const en1 = renderOrderConfirmationEmail({ lines: [lines[0]], period: "monthly", amount: 169, currency: "EUR", locale: "en" }, tFor("en"));
  assert.ok(!en1.text.includes("overage"), en1.text);
  assert.equal(formatOrderAmount(169, "EUR", "en"), "169 €");
  assert.equal(formatOrderAmount(0.39, "ILS", "en"), "0.39 ₪");
  // No supplier name in anything the customer sees.
  for (const m of [fr1, he1, en1]) assert.ok(!/openai|twilio|livekit|yaad|hyp/i.test(m.subject + m.text), "supplier name in the email");
}

console.log("order-lines: purchasable, selection, lines, overage, read-back, Info, email — all passed");
