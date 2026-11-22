// create-payment, multi-line body (P4): `{ products: { base, addons }, period, locale }`.
// SERVER-ONLY (lib/db). The legacy `{ plan, period, locale }` body never
// reaches this file: app/api/dashboard/hyp/create-payment/route.ts keeps its
// own code path, unchanged.
//
// The server computes EVERYTHING: the lines from the catalogue, the overage
// lines from the account's own calls, the sum. Any amount or line sent by the
// client is ignored (only `products`, `period` and `locale` are read).
//
// Overage and concurrency: overage lines are computed against PAID orders
// only. A pending order reserves nothing: two checkouts opened side by side
// can both carry the same overage line; the callback re-checks under a lock
// on the user row and refuses to record the same (entry, periodStart) twice
// (lib/order-activation.ts). An order created after a payment recomputes,
// so it no longer carries what that payment billed.
//
// Terms snapshot (lib/order-terms.ts): each base / add-on line is stored
// with the terms it is sold with; the response keeps `lines` in its P4 shape
// and adds `terms` (per base / add-on line) and `changes` (against the
// previous PAID multi-line order). `preview: true` returns the same body
// without creating anything (no order, no event, no lock, no HYP call).
//
// Currency lock (VP decision iii): an overage line is always priced in its
// period's own currency and rate. A currency switch is refused while one is
// pending: 409 { error: "overage_currency_pending", currency, amount } (the
// pending period's currency and the overage total in it; no message, the
// copy is the payment page's). Preview included. Nothing written, HYP
// never called.

import { and, eq, gte, isNotNull, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { calls, campaignCalls, paymentOrders, users } from "@/lib/db/schema";
import { CURRENCY_COIN, createPaymentUrl, currencyForLocale, pageLangFor } from "@/lib/hyp";
import { logEvent } from "@/lib/logger";
import {
  MAX_ORDER_AMOUNT,
  billedOverageKeys,
  catalogueLines,
  overageCurrencyConflict,
  orderInfo,
  orderTotal,
  parseOrderLines,
  parseOrderSelection,
  pendingOverage,
  planKeyForBase,
  withoutTerms,
  type OrderLine,
  type OrderPeriod,
  type PaidCoverage,
  type PendingOverage,
} from "@/lib/order-lines";
import { parseProductsRecord } from "@/lib/product-entitlement";
import { productTitle } from "@/lib/product-titles";
import type { CatalogueCurrency, ProductCatalogue } from "@/lib/product-catalogue";
import { getProductCatalogue } from "@/lib/products";
import { linesTerms, previousPaidOrder, termsChanges, type QuotedTerms, type TermsChange } from "@/lib/order-terms";

export type ProductsOrderBody = { products?: unknown; period?: unknown; locale?: unknown; preview?: unknown };

/** What the payment page shows: P4's fields, plus the terms and the changes. */
export type ProductsOrderQuote = {
  amount: number;
  currency: "EUR" | "ILS";
  /** P4's shape (no terms inside). */
  lines: OrderLine[];
  /** The terms of each base / add-on line, in line order. */
  terms: QuotedTerms[];
  /** What differs from the previous PAID multi-line order ([] for a first order). */
  changes: TermsChange[];
};

export type ProductsOrderResult =
  | { status: 200; body: ProductsOrderQuote & { url: string } }
  | { status: 200; body: ProductsOrderQuote & { preview: true } }
  | { status: 409; body: { error: "overage_currency_pending"; currency: CatalogueCurrency; amount: number } }
  | { status: 400 | 404 | 409; body: { error: string } };

/** A PAID multi-line order of an account: its lines, row currency and paid time. */
export type PaidOrder = { lines: OrderLine[]; currency: string; paidAt: Date | null };

/** Every PAID multi-line order of an account (legacy orders have no lines and are skipped). */
export async function paidOrders(userId: string, exec: Pick<typeof db, "select"> = db): Promise<PaidOrder[]> {
  const rows = await exec
    .select({ products: paymentOrders.products, currency: paymentOrders.currency, paidAt: paymentOrders.paidAt })
    .from(paymentOrders)
    .where(and(eq(paymentOrders.userId, userId), eq(paymentOrders.status, "paid"), isNotNull(paymentOrders.products)));
  const out: PaidOrder[] = [];
  for (const r of rows) {
    const lines = parseOrderLines(r.products);
    if (lines) out.push({ lines, currency: r.currency, paidAt: r.paidAt });
  }
  return out;
}

/** The lines of every PAID multi-line order of an account (legacy orders have none). */
export async function paidOrderLines(userId: string, exec: Pick<typeof db, "select"> = db): Promise<OrderLine[][]> {
  return (await paidOrders(userId, exec)).map((o) => o.lines);
}

/**
 * PURE: the payment page's view of new lines. `terms` from the lines'
 * snapshot; `changes` against the previous PAID multi-line order (latest
 * paidAt), whose lines without a snapshot are read from the live catalogue
 * in that order's own currency (their price = the amount paid).
 */
export function orderQuote(opts: {
  lines: readonly OrderLine[];
  amount: number;
  currency: "EUR" | "ILS";
  paid: readonly PaidOrder[];
  catalogue: ProductCatalogue;
}): ProductsOrderQuote {
  const prev = previousPaidOrder(opts.paid);
  const prevCurrency: CatalogueCurrency = prev?.currency === "ILS" ? "ILS" : "EUR";
  const terms = linesTerms(opts.lines);
  return {
    amount: opts.amount,
    currency: opts.currency,
    lines: withoutTerms(opts.lines),
    terms,
    changes: termsChanges(prev ? linesTerms(prev.lines, { catalogue: opts.catalogue, currency: prevCurrency }) : null, terms),
  };
}

/** The paid coverages (base line bounds) among paid orders' lines. */
export function coveragesOf(paid: OrderLine[][]): PaidCoverage[] {
  const out: PaidCoverage[] = [];
  for (const lines of paid) {
    const b = lines[0];
    if (b.kind !== "base" || !b.periodStart || !b.periodEnd) continue;
    out.push({
      start: new Date(b.periodStart),
      end: new Date(b.periodEnd),
      period: b.period,
      base: b.product,
      addons: lines.flatMap((l) => (l.kind === "addon" ? [l.product] : [])),
    });
  }
  return out;
}

/**
 * The unbilled overage of an account, each line in its period's currency
 * (record holders only; [] otherwise). `currency` (the new order's) is only
 * the fallback for a period no paid order covers.
 */
export async function pendingOverageFor(opts: {
  userId: string;
  products: unknown;
  currency: "EUR" | "ILS";
  now: Date;
  /** The account's paid orders, when the caller already read them. */
  paid?: PaidOrder[];
  catalogue?: ProductCatalogue;
}): Promise<PendingOverage[]> {
  // Grandfathered accounts (no valid record) are never billed overage.
  if (!parseProductsRecord(opts.products)) return [];
  const orders = opts.paid ?? (await paidOrders(opts.userId));
  const paid = orders.map((o) => o.lines);
  const coverages = coveragesOf(paid).filter((c) => c.start.getTime() < opts.now.getTime());
  if (coverages.length === 0) return [];
  const from = new Date(Math.min(...coverages.map((c) => c.start.getTime())));
  const to = new Date(Math.min(opts.now.getTime(), Math.max(...coverages.map((c) => c.end.getTime()))));
  const [callRows, campaignRows] = await Promise.all([
    db
      .select({ durationSeconds: calls.durationSeconds, product: calls.product, createdAt: calls.createdAt })
      .from(calls)
      .where(and(eq(calls.userId, opts.userId), gte(calls.createdAt, from), lt(calls.createdAt, to))),
    db
      .select({ durationSeconds: campaignCalls.durationSeconds, createdAt: campaignCalls.createdAt })
      .from(campaignCalls)
      .where(and(eq(campaignCalls.userId, opts.userId), gte(campaignCalls.createdAt, from), lt(campaignCalls.createdAt, to))),
  ]);
  return pendingOverage({
    coverages,
    calls: callRows,
    campaignCalls: campaignRows,
    catalogue: opts.catalogue ?? (await getProductCatalogue()),
    currency: opts.currency,
    // Each finished period at ITS pinned terms and currency (lib/order-terms.ts).
    paidOrders: orders,
    billed: billedOverageKeys(paid),
    now: opts.now,
  });
}

export async function createProductsOrder(
  userId: string,
  body: ProductsOrderBody,
  env: Record<string, string | undefined> = process.env,
): Promise<ProductsOrderResult> {
  const period = body.period;
  if (period !== "monthly" && period !== "annual") return { status: 400, body: { error: "invalid period" } };
  if (body.preview !== undefined && typeof body.preview !== "boolean") return { status: 400, body: { error: "invalid_preview" } };
  const preview = body.preview === true;
  const sel = parseOrderSelection(body.products, env);
  if (!sel.ok) return { status: sel.status, body: { error: sel.error } };

  const [user] = await db
    .select({ locale: users.locale, email: users.email, displayName: users.displayName, products: users.products })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return { status: 404, body: { error: "not found" } };

  // Name and locale: the same rules as the legacy branch (kept in step).
  const fullName = (user.displayName ?? "").trim();
  const emailLocal = user.email.split("@")[0] || "Client";
  const nameParts = fullName ? fullName.split(/\s+/) : [];
  const clientName = nameParts[0] || emailLocal;
  const clientLName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;
  const bodyLocale = typeof body.locale === "string" ? body.locale : undefined;
  const locale =
    bodyLocale && ["fr", "he", "en"].includes(bodyLocale)
      ? bodyLocale
      : ["fr", "he", "en"].includes(user.locale)
        ? user.locale
        : "fr";

  const currency = currencyForLocale(locale);
  const coin = CURRENCY_COIN[currency];
  const now = new Date();
  const p: OrderPeriod = period;
  // One catalogue read: the lines, their terms and the changes agree.
  const catalogue = await getProductCatalogue();
  const paid = await paidOrders(userId);
  const pending = await pendingOverageFor({ userId, products: user.products, currency, now, paid, catalogue });
  // A currency switch while overage is pending: refused, before anything is
  // written (preview included). The overage is paid in its own currency first.
  const conflict = overageCurrencyConflict(pending, currency);
  if (conflict) return { status: 409, body: { error: "overage_currency_pending", currency: conflict.currency, amount: conflict.amount } };
  const lines: OrderLine[] = [
    ...catalogueLines(sel.selection, p, currency, catalogue),
    // Only lines in the order's currency (with mixed pending currencies, the
    // later ones wait for an order in theirs: overageCurrencyConflict).
    ...pending.filter((o) => o.currency === currency).map((o) => o.line),
  ];
  const amount = orderTotal(lines);
  if (!(amount > 0) || amount > MAX_ORDER_AMOUNT) return { status: 409, body: { error: "amount_out_of_range" } };
  // Never null here: parseOrderSelection refuses a base without a plan key.
  const planKey = planKeyForBase(sel.selection.base);
  if (!planKey) return { status: 409, body: { error: "product_unavailable" } };
  const quote = orderQuote({ lines, amount, currency, paid, catalogue });
  // Preview: the same computation, nothing created or sent.
  if (preview) return { status: 200, body: { ...quote, preview: true } };

  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
  const [order] = await db
    .insert(paymentOrders)
    .values({ userId, planKey, period: p, currency, coin, expectedAmount: amount, status: "pending", expiresAt, products: lines })
    .returning({ id: paymentOrders.id });

  await logEvent({
    source: "web",
    event: "subscription_checkout_started",
    message: `Checkout HYP : ${sel.selection.base} +${sel.selection.addons.length} / ${p} → ${amount} ${currency} (locale ${locale})`,
    userId,
    metadata: {
      plan: planKey,
      period: p,
      currency,
      amount,
      locale,
      userLocale: user.locale,
      products: { base: sel.selection.base, addons: sel.selection.addons },
      overageLines: lines.filter((l) => l.kind === "overage").length,
    },
  });

  // Anti-race trial-cleanup, as the legacy branch.
  await db
    .update(users)
    .set({ deletionLockedUntil: new Date(now.getTime() + 2 * 60 * 60 * 1000) })
    .where(eq(users.id, userId));

  const base = process.env.APP_URL;
  const successUrl = base + "/api/dashboard/hyp/callback?locale=" + locale;
  const cancelUrl = base + "/api/dashboard/hyp/callback?locale=" + locale + "&cancelled=1";
  const url = await createPaymentUrl({
    orderId: order.id,
    amount,
    coin,
    info: orderInfo(locale, productTitle(locale, sel.selection.base), lines),
    pageLang: pageLangFor(locale),
    successUrl,
    cancelUrl,
    email: user.email,
    clientName,
    clientLName,
    issueToken: process.env.HYP_TOKENS_ENABLED === "1",
  });
  return { status: 200, body: { url, ...quote } };
}
