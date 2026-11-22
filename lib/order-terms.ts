// Order terms (pricing follow-up of P4): what a PAID multi-line order bought,
// pinned on its lines. PURE (no lib/db, no network, no clock), table-tested
// in scripts/tests/order-terms.test.ts.
//
// At creation, every base / add-on line carries `terms` = { price,
// includedMinutes, overageRate, currency } read from the catalogue at that
// moment (catalogueLines). They live in payment_orders.products with the
// lines (no new column). A catalogue edit therefore applies at the NEXT
// payment: the period a paid order covers keeps the minutes and the rate it
// was sold with.
//
// The ONE reader is termsFor (and pinnedCatalogue, built on it), used by:
//   - billing-stats usageByProduct (the display);
//   - the 80/100 % usage warnings;
//   - overage billing (computeOverageLines).
// The paid multi-line order whose base line period contains `at` decides;
// when none covers it, or the line predates the snapshot (no `terms`), the
// live catalogue in the requested currency (exactly the behaviour before).
//
// Currency: the terms are pinned in the order's currency.
//   - BILLING (computeOverageLines / pendingOverage): a period's overage is
//     always read in ITS OWN currency, so its pinned minutes AND rate apply.
//     A currency switch is refused while overage is pending (VP decision
//     iii, lib/order-create.ts: 409 overage_currency_pending); an overage
//     line is never priced in another currency.
//   - DISPLAY (usageByProduct in billing-stats, the usage warnings): read in
//     the page's currency. The included minutes are what was bought, so they
//     apply whatever the reading currency; the overage RATE is a price, shown
//     only when the reading currency is the pinned one, otherwise the live
//     catalogue's rate in the reading currency (an indication, not a bill;
//     there is no exchange rate anywhere).

import type { CatalogueCurrency, ProductCatalogue } from "./product-catalogue";
import type { Product } from "./product-values";
import type { OrderLine } from "./order-lines";

export type LineTerms = {
  /** The line's price for its period (monthly or annual), in `currency`. */
  price: number;
  /** Included minutes per MONTH. */
  includedMinutes: number;
  /** Price of a minute beyond them, in `currency`. */
  overageRate: number;
  currency: CatalogueCurrency;
};

const TERMS_KEYS = ["currency", "includedMinutes", "overageRate", "price"] as const;
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;

/** Strict read of a line's `terms`: exactly the four keys, valid values. */
export function parseLineTerms(x: unknown): LineTerms | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const v = x as Record<string, unknown>;
  const keys = Object.keys(v).sort();
  if (keys.length !== TERMS_KEYS.length || !TERMS_KEYS.every((k, i) => keys[i] === k)) return null;
  if (!isNum(v.price) || !isNum(v.includedMinutes) || !isNum(v.overageRate)) return null;
  if (v.currency !== "EUR" && v.currency !== "ILS") return null;
  return { price: v.price, includedMinutes: v.includedMinutes, overageRate: v.overageRate, currency: v.currency };
}

/** The terms of a product sold at `price` today (the snapshot written at creation). */
export function catalogueTerms(catalogue: ProductCatalogue, product: Product, currency: CatalogueCurrency, price: number): LineTerms {
  const row = catalogue[product][currency];
  return { price, includedMinutes: row.minutes, overageRate: row.overagePerMin, currency };
}

/** A paid order as the readers see it: its lines (and, for `changes`, its row currency). */
export type TermsOrder = { lines: readonly OrderLine[]; currency?: string };

/**
 * The paid order whose base line period contains `at` (start <= at < end).
 * Several (should not happen: coverages are consecutive) → the latest start.
 */
export function orderCovering<O extends TermsOrder>(orders: readonly O[], at: Date): O | null {
  const t = at.getTime();
  let best: O | null = null;
  let bestStart = -Infinity;
  for (const o of orders) {
    const b = o.lines[0];
    if (!b || b.kind !== "base" || !b.periodStart || !b.periodEnd) continue;
    const s = Date.parse(b.periodStart);
    const e = Date.parse(b.periodEnd);
    if (s <= t && t < e && s > bestStart) {
      best = o;
      bestStart = s;
    }
  }
  return best;
}

/** The pinned terms of `product` on an order's base / add-on lines (undefined = not on it, or no snapshot). */
function pinnedOn(lines: readonly OrderLine[], product: Product): LineTerms | undefined {
  for (const l of lines) if ((l.kind === "base" || l.kind === "addon") && l.product === product) return l.terms;
  return undefined;
}

/**
 * THE terms of `product` at `at`: the pinned ones of the PAID multi-line
 * order covering `at` when it carries them; else the live catalogue in
 * `live.currency` (price = the base monthly price, informative only: the
 * readers use the minutes and the rate).
 */
export function termsFor(
  orders: readonly TermsOrder[],
  product: Product,
  at: Date,
  live: { catalogue: ProductCatalogue; currency: CatalogueCurrency },
): LineTerms {
  const o = orderCovering(orders, at);
  const pinned = o ? pinnedOn(o.lines, product) : undefined;
  return pinned ?? catalogueTerms(live.catalogue, product, live.currency, live.catalogue[product][live.currency].monthly);
}

/**
 * The catalogue the usage readers compute with at `at`, in `currency`: the
 * live one, with each product's included minutes (always) and overage rate
 * (only when pinned in `currency`) replaced by termsFor. Overage billing
 * always passes the period's own currency (so the pinned rate applies);
 * only the display may read in another one. No covering paid
 * order (or no snapshot) → the live catalogue, unchanged values.
 */
export function pinnedCatalogue(
  live: ProductCatalogue,
  orders: readonly TermsOrder[],
  at: Date,
  currency: CatalogueCurrency,
): ProductCatalogue {
  const out = structuredClone(live);
  for (const p of Object.keys(live) as Product[]) {
    const t = termsFor(orders, p, at, { catalogue: live, currency });
    out[p][currency].minutes = t.includedMinutes;
    if (t.currency === currency) out[p][currency].overagePerMin = t.overageRate;
  }
  return out;
}

/** The instant that identifies a usage window's period: now, clamped into [start, end). */
export function termsAt(window: { start: Date; end: Date }, now: Date): Date {
  const t = Math.min(Math.max(now.getTime(), window.start.getTime()), window.end.getTime() - 1);
  return new Date(Math.max(t, window.start.getTime()));
}

// ── The payment page (F3): terms per line and changes ─────────────────

export type QuotedTerms = LineTerms & { kind: "base" | "addon"; product: Product };

/** The terms of an order's base / add-on lines, in line order (a line without a snapshot: from `fallback`). */
export function linesTerms(
  lines: readonly OrderLine[],
  fallback?: { catalogue: ProductCatalogue; currency: CatalogueCurrency },
): QuotedTerms[] {
  const out: QuotedTerms[] = [];
  for (const l of lines) {
    if (l.kind !== "base" && l.kind !== "addon") continue;
    const t = l.terms ?? (fallback ? catalogueTerms(fallback.catalogue, l.product, fallback.currency, l.amount) : undefined);
    if (t) out.push({ kind: l.kind, product: l.product, ...t });
  }
  return out;
}

export type TermsChange =
  | { product: Product; field: "price" | "includedMinutes" | "overageRate"; from: number; to: number }
  | { product: Product; field: "currency"; from: CatalogueCurrency; to: CatalogueCurrency }
  | { product: Product; field: "added"; from: null; to: LineTerms }
  | { product: Product; field: "removed"; from: LineTerms; to: null };

const FIELDS = ["price", "includedMinutes", "overageRate"] as const;
const strip = (t: QuotedTerms): LineTerms => ({ price: t.price, includedMinutes: t.includedMinutes, overageRate: t.overageRate, currency: t.currency });

/**
 * What differs between the PREVIOUS paid multi-line order's terms and the
 * new order's, product by product (whatever the line kind): a product only
 * in the new one → "added", only in the previous one → "removed", in both →
 * one entry per differing field (currency first, then price, includedMinutes,
 * overageRate; values compared as they are, in their own currency).
 * No previous order → [] (a first order). Order: the new order's lines, then
 * the removed products in the previous order's line order.
 */
export function termsChanges(previous: readonly QuotedTerms[] | null, next: readonly QuotedTerms[]): TermsChange[] {
  if (!previous) return [];
  const out: TermsChange[] = [];
  const prev = new Map(previous.map((t) => [t.product, t]));
  const seen = new Set<Product>();
  for (const n of next) {
    seen.add(n.product);
    const p = prev.get(n.product);
    if (!p) {
      out.push({ product: n.product, field: "added", from: null, to: strip(n) });
      continue;
    }
    if (p.currency !== n.currency) out.push({ product: n.product, field: "currency", from: p.currency, to: n.currency });
    for (const f of FIELDS) if (p[f] !== n[f]) out.push({ product: n.product, field: f, from: p[f], to: n[f] });
  }
  for (const p of previous) if (!seen.has(p.product)) out.push({ product: p.product, field: "removed", from: strip(p), to: null });
  return out;
}

/** The latest paid order (by paidAt); null when none. */
export function previousPaidOrder<O extends { paidAt: Date | null }>(orders: readonly O[]): O | null {
  let best: O | null = null;
  for (const o of orders) if (o.paidAt && (!best || (best.paidAt as Date).getTime() < o.paidAt.getTime())) best = o;
  return best;
}
