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

import { and, eq, gte, isNotNull, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { calls, campaignCalls, paymentOrders, users } from "@/lib/db/schema";
import { CURRENCY_COIN, createPaymentUrl, currencyForLocale, pageLangFor } from "@/lib/hyp";
import { logEvent } from "@/lib/logger";
import {
  MAX_ORDER_AMOUNT,
  billedOverageKeys,
  catalogueLines,
  computeOverageLines,
  orderInfo,
  orderTotal,
  parseOrderLines,
  parseOrderSelection,
  planKeyForBase,
  type OrderLine,
  type OrderPeriod,
  type PaidCoverage,
} from "@/lib/order-lines";
import { parseProductsRecord } from "@/lib/product-entitlement";
import { productTitle } from "@/lib/product-titles";
import { getProductCatalogue } from "@/lib/products";

export type ProductsOrderBody = { products?: unknown; period?: unknown; locale?: unknown };

export type ProductsOrderResult =
  | { status: 200; body: { url: string; amount: number; currency: "EUR" | "ILS"; lines: OrderLine[] } }
  | { status: 400 | 404 | 409; body: { error: string } };

/** The lines of every PAID multi-line order of an account (legacy orders have none). */
export async function paidOrderLines(userId: string, exec: Pick<typeof db, "select"> = db): Promise<OrderLine[][]> {
  const rows = await exec
    .select({ products: paymentOrders.products })
    .from(paymentOrders)
    .where(and(eq(paymentOrders.userId, userId), eq(paymentOrders.status, "paid"), isNotNull(paymentOrders.products)));
  const out: OrderLine[][] = [];
  for (const r of rows) {
    const lines = parseOrderLines(r.products);
    if (lines) out.push(lines);
  }
  return out;
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

/** The overage lines for an account's next order (record holders only; [] otherwise). */
export async function overageLinesFor(opts: {
  userId: string;
  products: unknown;
  currency: "EUR" | "ILS";
  now: Date;
}): Promise<OrderLine[]> {
  // Grandfathered accounts (no valid record) are never billed overage.
  if (!parseProductsRecord(opts.products)) return [];
  const paid = await paidOrderLines(opts.userId);
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
  return computeOverageLines({
    coverages,
    calls: callRows,
    campaignCalls: campaignRows,
    catalogue: await getProductCatalogue(),
    currency: opts.currency,
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
  const lines: OrderLine[] = [
    ...catalogueLines(sel.selection, p, currency, await getProductCatalogue()),
    ...(await overageLinesFor({ userId, products: user.products, currency, now })),
  ];
  const amount = orderTotal(lines);
  if (!(amount > 0) || amount > MAX_ORDER_AMOUNT) return { status: 409, body: { error: "amount_out_of_range" } };
  // Never null here: parseOrderSelection refuses a base without a plan key.
  const planKey = planKeyForBase(sel.selection.base);
  if (!planKey) return { status: 409, body: { error: "product_unavailable" } };

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
  return { status: 200, body: { url, amount, currency, lines } };
}
