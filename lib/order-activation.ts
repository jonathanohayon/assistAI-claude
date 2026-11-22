// HYP callback, multi-line order (P4): payment_orders.products is NOT NULL.
// SERVER-ONLY (lib/db). Called by app/api/dashboard/hyp/callback/route.ts
// AFTER the same VERIFY, the same Order check and the same validateHypReturn
// (amount + coin against expected_amount = the SUM of the lines). A legacy
// order (products NULL) never reaches this file.
//
// What a paid multi-line order does, in ONE transaction:
//   - the order row is locked (FOR UPDATE); already paid → nothing (idempotent,
//     as the legacy path);
//   - the USER row is locked too (FOR UPDATE), so two orders of the same
//     account activate one after the other; then, if one of this order's
//     overage lines is already on another PAID order, the payment is refused
//     (status failed + an admin alert for the refund): the same overage is
//     never recorded as billed twice;
//   - users: the legacy fields exactly as the legacy path (status active,
//     plan = the order's plan_key, period, paidUntil, trial cleared, card
//     fields) plus products = { base, addons } from the lines;
//   - the order: paid, paidAt, hyp_transaction_id, raw response, and the base
//     line gains the period it paid for (periodStart / periodEnd). Overage
//     lines are recorded as billed by the order being PAID.
// Then the logs and the confirmation email listing the lines (best-effort).

import { and, eq, isNotNull, ne } from "drizzle-orm";

import { alertAdmins } from "@/lib/alerts";
import { nextPaidUntil } from "@/lib/billing-activation";
import type { Period } from "@/lib/billing-pricing";
import { db } from "@/lib/db";
import { paymentOrders, users } from "@/lib/db/schema";
import { sendOrderConfirmationEmail } from "@/lib/email";
import { extractCardFromVerify } from "@/lib/hyp";
import { logEvent } from "@/lib/logger";
import { billedOverageKeys, overageKey, parseOrderLines, selectionOf, type OrderLine } from "@/lib/order-lines";

export type ActivationOrder = {
  id: string;
  userId: string;
  planKey: string;
  period: string;
  currency: string;
  expectedAmount: number;
  products: unknown;
};

/** The start of the period a payment buys: the same base as nextPaidUntil. */
export function coverageStart(currentPaidUntil: Date | null | undefined, now: Date): Date {
  return currentPaidUntil && currentPaidUntil.getTime() > now.getTime() ? currentPaidUntil : now;
}

type TxResult = { kind: "paid" } | { kind: "already" } | { kind: "overage_already_billed"; keys: string[] };

/** Returns the billing query suffix ("?paid=1" | "?payment=failed"). */
export async function activateProductsOrder(opts: {
  order: ActivationOrder;
  period: Period;
  verifyRaw: Record<string, string>;
  now: Date;
  locale: string;
}): Promise<string> {
  const { order, period, now } = opts;
  const raw = opts.verifyRaw;
  const lines = parseOrderLines(order.products);
  if (!lines) {
    await db.update(paymentOrders).set({ status: "failed", rawResponse: raw }).where(eq(paymentOrders.id, order.id));
    await logEvent({
      source: "auth",
      event: "subscription_payment_rejected",
      message: `Lignes de commande illisibles (order ${order.id})`,
      level: "warn",
      userId: order.userId,
      metadata: { orderId: order.id, reason: "invalid_lines" },
    });
    await alertAdmins({
      key: `payment_needs_review:${order.id}`,
      subject: "A paid HYP order could not be activated",
      body: `Order ${order.id}: its lines are unreadable. HYP verified the payment; check it and refund or activate by hand.`,
      dedupMs: 24 * 60 * 60 * 1000,
    });
    return "?payment=failed";
  }
  const txnId = raw.Id ?? null;

  let result: TxResult;
  try {
    result = await db.transaction(async (tx): Promise<TxResult> => {
      const [order2] = await tx
        .select({ status: paymentOrders.status })
        .from(paymentOrders)
        .where(eq(paymentOrders.id, order.id))
        .for("update");
      if (order2?.status === "paid") return { kind: "already" };

      const [user] = await tx
        .select({ paidUntil: users.paidUntil })
        .from(users)
        .where(eq(users.id, order.userId))
        .for("update");

      // Never record the same (entry, periodStart) as billed twice.
      const others = await tx
        .select({ products: paymentOrders.products })
        .from(paymentOrders)
        .where(
          and(
            eq(paymentOrders.userId, order.userId),
            eq(paymentOrders.status, "paid"),
            isNotNull(paymentOrders.products),
            ne(paymentOrders.id, order.id),
          ),
        );
      const billed = billedOverageKeys(
        others.flatMap((r) => {
          const l = parseOrderLines(r.products);
          return l ? [l] : [];
        }),
      );
      const dup = lines.flatMap((l) => (l.kind === "overage" && billed.has(overageKey(l.entry, l.periodStart)) ? [overageKey(l.entry, l.periodStart)] : []));
      if (dup.length > 0) return { kind: "overage_already_billed", keys: dup };

      const start = coverageStart(user?.paidUntil, now);
      const newPaidUntil = nextPaidUntil(user?.paidUntil, now, period);
      const card = extractCardFromVerify(raw);
      const paidLines: OrderLine[] = lines.map((l, i) =>
        i === 0 && l.kind === "base" ? { ...l, periodStart: start.toISOString(), periodEnd: newPaidUntil.toISOString() } : l,
      );

      await tx
        .update(users)
        .set({
          subscriptionStatus: "active",
          subscriptionPlan: order.planKey,
          subscriptionPeriod: period,
          paidUntil: newPaidUntil,
          autoRenew: true,
          cancelledAt: null,
          trialEndsAt: null,
          trialWarningSentAt: null,
          deletionLockedUntil: null,
          products: selectionOf(lines),
          ...(card.token ? { hypToken: card.token } : {}),
          ...(card.tokenExp ? { hypTokenExp: card.tokenExp } : {}),
          ...(card.last4 ? { cardLast4: card.last4 } : {}),
          ...(card.brand ? { cardBrand: card.brand } : {}),
        })
        .where(eq(users.id, order.userId));

      await tx
        .update(paymentOrders)
        .set({ status: "paid", paidAt: now, hypTransactionId: txnId, rawResponse: raw, products: paidLines })
        .where(eq(paymentOrders.id, order.id));
      return { kind: "paid" };
    });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const msg = err instanceof Error ? err.message : String(err);
    if (code === "23505" || msg.includes("hyp_transaction_id") || msg.includes("duplicate")) {
      await logEvent({
        source: "auth",
        event: "subscription_payment_duplicate",
        message: `Transaction HYP déjà utilisée (order ${order.id}, txn ${txnId ?? "?"})`,
        level: "warn",
        userId: order.userId,
        metadata: { orderId: order.id, txnId },
      });
      return "?payment=failed";
    }
    throw err;
  }

  if (result.kind === "already") return "?paid=1";
  if (result.kind === "overage_already_billed") {
    await db.update(paymentOrders).set({ status: "failed", rawResponse: raw }).where(eq(paymentOrders.id, order.id));
    await logEvent({
      source: "auth",
      event: "subscription_payment_rejected",
      message: `Dépassement déjà facturé (order ${order.id}) : remboursement à faire`,
      level: "warn",
      userId: order.userId,
      metadata: { orderId: order.id, reason: "overage_already_billed", keys: result.keys },
    });
    await alertAdmins({
      key: `payment_needs_review:${order.id}`,
      subject: "A paid HYP order repeated an overage already billed",
      body: `Order ${order.id} was paid on HYP but carries an overage already billed by another paid order (${result.keys.join(", ")}). It was NOT activated: refund it on the masof.`,
      dedupMs: 24 * 60 * 60 * 1000,
    });
    return "?payment=failed";
  }

  await logEvent({
    source: "auth",
    event: "subscription_paid",
    message: `Abonnement activé (${order.planKey} / ${order.period}, ${lines.length} lignes) pour user ${order.userId}`,
    userId: order.userId,
    metadata: {
      plan: order.planKey,
      period: order.period,
      amount: order.expectedAmount,
      currency: order.currency,
      txnId,
      lines: lines.map((l) => l.kind),
    },
  });

  try {
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, order.userId)).limit(1);
    if (u?.email) {
      const mail = await sendOrderConfirmationEmail(u.email, {
        lines,
        period,
        amount: order.expectedAmount,
        currency: order.currency,
        locale: opts.locale,
      });
      if (!mail.ok) {
        await logEvent({
          source: "auth",
          event: "subscription_email_failed",
          message: `Échec envoi email de confirmation : ${mail.error?.slice(0, 200) ?? "?"}`,
          level: "warn",
          userId: order.userId,
          metadata: { error: mail.error },
        });
      }
    }
  } catch (e) {
    await logEvent({
      source: "auth",
      event: "subscription_email_failed",
      message: `Exception envoi email de confirmation (order ${order.id})`,
      level: "warn",
      userId: order.userId,
      metadata: { error: e instanceof Error ? e.message : String(e) },
    });
  }
  return "?paid=1";
}
