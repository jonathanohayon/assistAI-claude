// Multi-line HYP orders (P4): one subscription = a BASE product + add-ons,
// paid as ONE HYP charge whose Amount is the SUM of the lines. PURE (no
// lib/db, no network, no clock): everything the server decides about an
// order is computed here and table-tested (scripts/tests/order-lines.test.ts).
//
// What lives here:
//   - productPurchasable / planKeyForBase: what may be bought today;
//   - parseOrderSelection: the strict validation of `{ base, addons }`;
//   - catalogueLines: the base + add-on lines from the catalogue;
//   - billingPeriodsOf / computeOverageLines: the overage lines (record
//     holders only), each (entry, periodStart) billed at most once;
//   - orderTotal: the sum, in integer cents (HYP gets toFixed(2) of it, as
//     every legacy amount, lib/hyp.ts createPaymentUrl);
//   - parseOrderLines: the strict read-back of payment_orders.products;
//   - orderInfo: the short HYP `Info` text.
//
// A legacy order (payment_orders.products NULL) never goes through this file.

import { dispatchMode } from "./campaigns/dispatch-mode";
import { monthlySubPeriods } from "./monthly-periods";
import type { CatalogueCurrency, ProductCatalogue } from "./product-catalogue";
import { PRODUCT_ENTRIES, PRODUCTS, entryOf, type Product, type ProductEntry } from "./product-values";
import { catalogueTerms, orderCovering, parseLineTerms, pinnedCatalogue, type LineTerms, type TermsOrder } from "./order-terms";
import type { PlanKey } from "./plans";
import { clientAgentMode } from "./tools/client-agent-switch";
import { usageByProduct, type UsageCall, type UsageCampaignCall } from "./usage-by-product";

export type OrderPeriod = "monthly" | "annual";

export type BaseLine = {
  kind: "base";
  product: Product;
  period: OrderPeriod;
  amount: number;
  /**
   * The terms this line was sold with (lib/order-terms.ts), pinned at
   * creation. Absent on an order created before the snapshot (read with the
   * live catalogue as fallback).
   */
  terms?: LineTerms;
  /**
   * The subscription period this line paid for, ISO. Set by the callback
   * when the order is PAID (the same bounds as users.paidUntil); absent on a
   * pending / failed order. Overage is computed only over these periods.
   */
  periodStart?: string;
  periodEnd?: string;
};
export type AddonLine = { kind: "addon"; product: Product; period: OrderPeriod; amount: number; terms?: LineTerms };
export type OverageLine = {
  kind: "overage";
  entry: ProductEntry;
  /** ISO bounds of the (monthly) billing period the minutes were used in. */
  periodStart: string;
  periodEnd: string;
  minutes: number;
  amount: number;
};
export type OrderLine = BaseLine | AddonLine | OverageLine;

export type OrderSelection = { base: Product; addons: Product[] };

// ── What may be bought ─────────────────────────────────────────────────

/**
 * Whether a product can be sold today (purchasable = usable):
 *   reception, reception_multi: always;
 *   sales:   only when campaign dispatch is on (CAMPAIGN_DISPATCH=on);
 *   connect: only when the client agent is on for every account (CLIENT_AGENT=all).
 * This governs ADD-ONS. A base must also have a plan key (planKeyForBase).
 */
export function productPurchasable(product: Product, env: Record<string, string | undefined>): boolean {
  switch (product) {
    case "reception":
    case "reception_multi":
      return true;
    case "sales":
      return dispatchMode(env) === "on";
    case "connect":
      return clientAgentMode(env) === "all";
  }
}

/**
 * The legacy plan key written to payment_orders.plan_key and
 * users.subscription_plan for a BASE product. The ONE place of this mapping.
 * Only the two reception products can be a base in P4: sales / connect get
 * their own plan keys in a later step (never global / premium), so a sales
 * or connect base is refused whatever the flags.
 */
export const BASE_PLAN_KEY: Readonly<Partial<Record<Product, PlanKey>>> = {
  reception: "global",
  reception_multi: "premium",
};

export function planKeyForBase(base: Product): PlanKey | null {
  return BASE_PLAN_KEY[base] ?? null;
}

const isProduct = (x: unknown): x is Product => typeof x === "string" && (PRODUCTS as readonly string[]).includes(x);

export type SelectionError = { ok: false; status: 400 | 409; error: string };

/**
 * Strict validation of the client's `products` field. Nothing else in the
 * body is trusted (no amount, no line is ever read from the client).
 *   400 invalid_products   not { base, addons[] } (extra keys refused too)
 *   400 unknown_product    a base or add-on that is not a catalogue product
 *   400 duplicate_addon    the same add-on twice
 *   400 base_in_addons     the base repeated as an add-on
 *   400 addon_not_sold     reception_multi as an add-on (no add-on price, by design)
 *   400 addon_same_family  an add-on of the base's own family (entryOf): a
 *                          reception_multi base never takes reception
 *   409 product_unavailable a base without a plan key (sales / connect), or a
 *                          product productPurchasable refuses
 */
export function parseOrderSelection(
  raw: unknown,
  env: Record<string, string | undefined>,
): { ok: true; selection: OrderSelection } | SelectionError {
  const bad = (status: 400 | 409, error: string): SelectionError => ({ ok: false, status, error });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad(400, "invalid_products");
  const keys = Object.keys(raw).sort();
  if (keys.length !== 2 || keys[0] !== "addons" || keys[1] !== "base") return bad(400, "invalid_products");
  const { base, addons } = raw as { base: unknown; addons: unknown };
  if (!Array.isArray(addons)) return bad(400, "invalid_products");
  if (!isProduct(base) || !addons.every(isProduct)) return bad(400, "unknown_product");
  const list = addons as Product[];
  if (new Set(list).size !== list.length) return bad(400, "duplicate_addon");
  if (list.includes(base)) return bad(400, "base_in_addons");
  if (list.includes("reception_multi")) return bad(400, "addon_not_sold");
  if (list.some((a) => entryOf(a) === entryOf(base))) return bad(400, "addon_same_family");
  if (planKeyForBase(base) === null || !productPurchasable(base, env)) return bad(409, "product_unavailable");
  if (!list.every((a) => productPurchasable(a, env))) return bad(409, "product_unavailable");
  return { ok: true, selection: { base, addons: [...list] } };
}

// ── Lines and total ────────────────────────────────────────────────────

/**
 * The base + add-on lines, priced from the catalogue for the currency and
 * period, each carrying the terms it is sold with (price, included minutes,
 * overage rate, currency: the snapshot, lib/order-terms.ts).
 */
export function catalogueLines(
  sel: OrderSelection,
  period: OrderPeriod,
  currency: CatalogueCurrency,
  catalogue: ProductCatalogue,
): Array<BaseLine | AddonLine> {
  const baseRow = catalogue[sel.base][currency];
  const baseAmount = period === "annual" ? baseRow.annual : baseRow.monthly;
  const lines: Array<BaseLine | AddonLine> = [
    { kind: "base", product: sel.base, period, amount: baseAmount, terms: catalogueTerms(catalogue, sel.base, currency, baseAmount) },
  ];
  for (const a of sel.addons) {
    const row = catalogue[a][currency];
    const amount = period === "annual" ? row.addonAnnual : row.addonMonthly;
    // parseOrderSelection refuses reception_multi as an add-on, the only
    // product without an add-on price; this is the belt.
    if (amount === null) throw new Error(`no add-on price for ${a}`);
    lines.push({ kind: "addon", product: a, period, amount, terms: catalogueTerms(catalogue, a, currency, amount) });
  }
  return lines;
}

const toCents = (n: number) => Math.round(n * 100);

/** The sum of the lines, computed in integer cents (no float drift). */
export function orderTotal(lines: readonly OrderLine[]): number {
  return lines.reduce((s, l) => s + toCents(l.amount), 0) / 100;
}

/**
 * payment_orders.expected_amount is a `real` (float4): above 2^16 its step
 * is coarser than a cent, so toFixed(2) could drift. No order gets near
 * (the largest annual ILS basket is far below), and anything above is refused.
 */
export const MAX_ORDER_AMOUNT = 65535;

// ── Overage ────────────────────────────────────────────────────────────

/** A period paid by a PAID multi-line order (its base line's bounds) and what it owned. */
export type PaidCoverage = { start: Date; end: Date; period: OrderPeriod; base: Product; addons: Product[] };

/**
 * The monthly billing periods inside a paid coverage. The catalogue's
 * included minutes are per MONTH, so an annual coverage is twelve monthly
 * periods (monthlySubPeriods, shared with the usage display and warnings);
 * a monthly coverage is itself.
 */
export function billingPeriodsOf(c: PaidCoverage): Array<{ start: Date; end: Date }> {
  if (c.period === "monthly") return [{ start: c.start, end: c.end }];
  // The shared split (lib/monthly-periods.ts): the billing-stats display and
  // the usage warnings use the very same month boundaries.
  return monthlySubPeriods(c.start, c.end);
}

/** The key that makes an overage billable once: entry + period start (ISO). */
export function overageKey(entry: ProductEntry, periodStart: string): string {
  return `${entry}|${periodStart}`;
}

/** Every overage key already on a PAID order's lines. */
export function billedOverageKeys(paidOrderLines: ReadonlyArray<readonly OrderLine[]>): Set<string> {
  const out = new Set<string>();
  for (const lines of paidOrderLines) for (const l of lines) if (l.kind === "overage") out.add(overageKey(l.entry, l.periodStart));
  return out;
}

export type OverageInput = {
  /** The coverages of the account's PAID multi-line orders (never a legacy order). */
  coverages: PaidCoverage[];
  calls: UsageCall[];
  campaignCalls: UsageCampaignCall[];
  catalogue: ProductCatalogue;
  /**
   * The NEW order's currency. An overage line is never priced in it: each
   * period is priced in ITS OWN currency (the paid order covering it). This
   * is only the fallback when no paid order is given (paidOrders absent),
   * and computeOverageLines refuses to return a line in another currency.
   */
  currency: CatalogueCurrency;
  /**
   * The account's PAID multi-line orders: each period is measured against
   * the terms pinned on the order covering it (termsFor), in that order's
   * currency. Absent = the live catalogue in `currency` (the behaviour
   * before the snapshot).
   */
  paidOrders?: readonly TermsOrder[];
  /** billedOverageKeys over the account's PAID orders (pending / failed never count). */
  billed: Set<string>;
  now: Date;
};

/** An unbilled overage line and the currency it is priced in (its period's). */
export type PendingOverage = { line: OverageLine; currency: CatalogueCurrency };

const asCurrency = (x: unknown): CatalogueCurrency | null => (x === "EUR" || x === "ILS" ? x : null);

/**
 * The currency of the period starting at `at`: the paid order covering it,
 * read from its base line's pinned terms, else the order row's currency
 * (an order before the snapshot); no covering order → `fallback`.
 */
export function periodCurrency(orders: readonly TermsOrder[], at: Date, fallback: CatalogueCurrency): CatalogueCurrency {
  const o = orderCovering(orders, at);
  if (!o) return fallback;
  const b = o.lines[0];
  return (b && b.kind === "base" ? b.terms?.currency : undefined) ?? asCurrency(o.currency) ?? fallback;
}

/**
 * Every unbilled overage line, each in its period's OWN currency and at its
 * period's pinned terms. For each COMPLETED monthly period (end <= now) of
 * each paid coverage, and each entry the coverage OWNED with overage > 0
 * (usageByProduct, P2), one line, unless that (entry, periodStart) is
 * already billed. Usage on an entry the coverage did not own (e.g. a
 * per-product trial) is never billed. A call belongs to [start, end) here,
 * so one call on a boundary is billed once. Sorted by period start, then
 * PRODUCT_ENTRIES order.
 */
export function pendingOverage(input: OverageInput): PendingOverage[] {
  const out: PendingOverage[] = [];
  const seen = new Set(input.billed);
  const orders = input.paidOrders ?? [];
  const periods = input.coverages
    .flatMap((c) => billingPeriodsOf(c).map((w) => ({ w, c })))
    .sort((a, b) => a.w.start.getTime() - b.w.start.getTime());
  for (const { w, c } of periods) {
    if (w.end.getTime() > input.now.getTime()) continue;
    const before = (d: Date) => d.getTime() < w.end.getTime();
    // The period's own currency: its pinned rate always applies (there is
    // no cross-currency pricing of an overage line).
    const currency = periodCurrency(orders, w.start, input.currency);
    const usage = usageByProduct({
      calls: input.calls.filter((x) => before(x.createdAt)),
      campaignCalls: input.campaignCalls.filter((x) => before(x.createdAt)),
      window: w,
      entitlement: { base: c.base, addons: c.addons, entries: [], source: "products" },
      // The period's own terms (lib/order-terms.ts): an edit made after the
      // payment never reprices a finished period.
      catalogue: pinnedCatalogue(input.catalogue, orders, w.start, currency),
      currency,
      planMinutes: 0,
      planOverage: 0,
    });
    if (usage.kind !== "products") continue;
    const periodStart = w.start.toISOString();
    for (const entry of PRODUCT_ENTRIES) {
      const e = usage.entries.find((x) => x.entry === entry);
      if (!e || !e.owned || e.overageAmount <= 0) continue;
      const key = overageKey(entry, periodStart);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        line: { kind: "overage", entry, periodStart, periodEnd: w.end.toISOString(), minutes: e.overageMinutes, amount: e.overageAmount },
        currency,
      });
    }
  }
  return out;
}

/**
 * A currency switch is refused while overage is pending (VP decision iii).
 * The FIRST pending line (by period start) decides: when its currency is not
 * the requested order's → { currency: that one, amount: the total of the
 * pending lines in that currency, in integer cents }. Otherwise null, and
 * the order carries the pending lines in its currency.
 * Several pending periods in DIFFERENT currencies (only after past
 * switches): the first one's currency is asked for; once it is paid, the
 * next order is asked for the next one's. Refusing whenever ANY pending line
 * differs would refuse both currencies forever.
 */
export function overageCurrencyConflict(
  pending: readonly PendingOverage[],
  currency: CatalogueCurrency,
): { currency: CatalogueCurrency; amount: number } | null {
  const first = pending[0];
  if (!first || first.currency === currency) return null;
  const amount = pending.filter((p) => p.currency === first.currency).reduce((s, p) => s + toCents(p.line.amount), 0) / 100;
  return { currency: first.currency, amount };
}

/**
 * The overage lines to add to an order in `input.currency`: the pending
 * lines in that currency. The caller refuses first (overageCurrencyConflict);
 * a first pending line in another currency here is a bug → throws.
 * Lines of a later period in another currency (mixed currencies) stay
 * pending for a later order in that currency.
 */
export function computeOverageLines(input: OverageInput): OverageLine[] {
  const pending = pendingOverage(input);
  if (overageCurrencyConflict(pending, input.currency)) throw new Error("overage pending in another currency");
  return pending.filter((p) => p.currency === input.currency).map((p) => p.line);
}

// ── Read-back ──────────────────────────────────────────────────────────

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;
const isPeriod = (x: unknown): x is OrderPeriod => x === "monthly" || x === "annual";
const isIso = (x: unknown): x is string => typeof x === "string" && !Number.isNaN(Date.parse(x));
const isEntry = (x: unknown): x is ProductEntry => typeof x === "string" && (PRODUCT_ENTRIES as readonly string[]).includes(x);

/**
 * Strict read of payment_orders.products: an array of valid lines with
 * exactly one base line, first. Anything else → null (the caller treats the
 * order as broken, never as a legacy order: products NULL is checked first).
 */
export function parseOrderLines(x: unknown): OrderLine[] | null {
  if (!Array.isArray(x) || x.length === 0) return null;
  const out: OrderLine[] = [];
  for (const [i, l] of x.entries()) {
    if (typeof l !== "object" || l === null) return null;
    const v = l as Record<string, unknown>;
    // `terms` is optional (orders before the snapshot); present, it must be valid.
    const terms = v.terms === undefined ? undefined : parseLineTerms(v.terms);
    if (terms === null) return null;
    if (v.kind === "base" && i === 0 && isProduct(v.product) && isPeriod(v.period) && isNum(v.amount)) {
      if ((v.periodStart !== undefined || v.periodEnd !== undefined) && !(isIso(v.periodStart) && isIso(v.periodEnd))) return null;
      out.push({
        kind: "base",
        product: v.product,
        period: v.period,
        amount: v.amount,
        ...(terms ? { terms } : {}),
        ...(v.periodStart !== undefined ? { periodStart: v.periodStart as string, periodEnd: v.periodEnd as string } : {}),
      });
    } else if (v.kind === "addon" && i > 0 && isProduct(v.product) && isPeriod(v.period) && isNum(v.amount)) {
      out.push({ kind: "addon", product: v.product, period: v.period, amount: v.amount, ...(terms ? { terms } : {}) });
    } else if (v.kind === "overage" && i > 0 && terms === undefined && isEntry(v.entry) && isIso(v.periodStart) && isIso(v.periodEnd) && isNum(v.minutes) && isNum(v.amount)) {
      out.push({ kind: "overage", entry: v.entry, periodStart: v.periodStart, periodEnd: v.periodEnd, minutes: v.minutes, amount: v.amount });
    } else {
      return null;
    }
  }
  return out;
}

/** The { base, addons } a paid order's lines grant (written to users.products). */
export function selectionOf(lines: readonly OrderLine[]): OrderSelection {
  const base = lines[0];
  if (base.kind !== "base") throw new Error("order lines without a base line");
  return { base: base.product, addons: lines.filter((l): l is AddonLine => l.kind === "addon").map((l) => l.product) };
}

// ── HYP Info ───────────────────────────────────────────────────────────

const INFO_WORDS: Record<"fr" | "he" | "en", { options: (n: number) => string; overage: string; period: Record<OrderPeriod, string> }> = {
  fr: { options: (n) => `+${n} option${n > 1 ? "s" : ""}`, overage: "+ dépassement", period: { monthly: "mensuel", annual: "annuel" } },
  en: { options: (n) => `+${n} add-on${n > 1 ? "s" : ""}`, overage: "+ overage", period: { monthly: "monthly", annual: "annual" } },
  he: { options: (n) => `+${n} תוספות`, overage: "+ חריגה", period: { monthly: "חודשי", annual: "שנתי" } },
};

/**
 * The HYP `Info` of a multi-line order: the base product's title, "+N
 * options" when there are add-ons, "+ dépassement" when there is overage,
 * and the period, in the page's locale. No supplier name. ≤ 160 chars
 * (createPaymentUrl slices anyway).
 */
export function orderInfo(locale: string, baseTitle: string, lines: readonly OrderLine[]): string {
  const w = INFO_WORDS[locale === "he" || locale === "en" ? locale : "fr"];
  const addons = lines.filter((l) => l.kind === "addon").length;
  const overage = lines.some((l) => l.kind === "overage");
  const period = lines[0]?.kind === "base" ? lines[0].period : "monthly";
  return [baseTitle, addons > 0 ? w.options(addons) : "", overage ? w.overage : "", `(${w.period[period]})`]
    .filter(Boolean)
    .join(" ")
    .slice(0, 160);
}

/**
 * The lines without their `terms` snapshot: the shape every response field
 * named `lines` had before the snapshot (create-payment, billing-stats
 * invoices). The terms are exposed separately where they are wanted.
 */
export function withoutTerms(lines: readonly OrderLine[]): OrderLine[] {
  return lines.map((l) => {
    if (l.kind === "overage" || l.terms === undefined) return l;
    const { terms: _terms, ...rest } = l;
    void _terms;
    return rest;
  });
}

/**
 * The additive `lines` of a billing-stats invoice row: present only for a
 * multi-line order (products NOT NULL and readable). A legacy row gets {}
 * (no key), so it stays byte-identical. The terms snapshot is not shown
 * (same shape as before it).
 */
export function invoiceLines(products: unknown): { lines?: OrderLine[] } {
  if (products == null) return {};
  const lines = parseOrderLines(products);
  return lines ? { lines: withoutTerms(lines) } : {};
}
