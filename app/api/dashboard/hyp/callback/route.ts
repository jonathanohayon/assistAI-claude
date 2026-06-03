import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { nextPaidUntil, validateHypReturn } from "@/lib/billing-activation";
import type { Period } from "@/lib/billing-pricing";
import { db } from "@/lib/db";
import { paymentOrders, users } from "@/lib/db/schema";
import { verifyPayment } from "@/lib/hyp";
import { logEvent } from "@/lib/logger";

export const dynamic = "force-dynamic";

// HYP redirige le navigateur ici (GET) après le paiement. On vérifie la
// signature/montant côté serveur, on active l'abonnement de façon idempotente
// (re-select FOR UPDATE + garde unique sur hyp_transaction_id), puis on
// redirige vers la page billing avec un flag de statut.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  // Whitelist stricte de la locale : elle est interpolée dans l'URL de
  // redirection, donc une valeur arbitraire (ex: "//evil.com") serait un
  // open-redirect. On retombe sur "fr" si la valeur n'est pas connue.
  const rawLocale = params.locale || "fr";
  const locale = ["fr", "he", "en"].includes(rawLocale) ? rawLocale : "fr";

  // Le paiement tourne dans une iframe (popup sur le dashboard). Au retour HYP
  // on est donc DANS l'iframe : on renvoie une mini-page qui casse vers le
  // top-level (window.top, même origine = autorisé) pour que la page parente
  // navigue. Hors iframe window.top === window → fonctionne aussi en direct.
  const billing = (q: string) => {
    const target = "/" + locale + "/dashboard/billing" + q;
    const html =
      '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
      "var t=" +
      JSON.stringify(target) +
      ";try{(window.top||window).location.replace(t);}catch(e){window.location.replace(t);}" +
      "</script></body></html>";
    return new NextResponse(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };

  // Annulation explicite (cancelUrl de HYP) — pas de paiement à vérifier.
  if (params.cancelled === "1") return billing("?payment=cancelled");

  const orderId = params.Order;
  if (!orderId) return billing("?payment=failed");

  const [order] = await db
    .select({
      id: paymentOrders.id,
      userId: paymentOrders.userId,
      planKey: paymentOrders.planKey,
      period: paymentOrders.period,
      currency: paymentOrders.currency,
      coin: paymentOrders.coin,
      expectedAmount: paymentOrders.expectedAmount,
      status: paymentOrders.status,
      expiresAt: paymentOrders.expiresAt,
    })
    .from(paymentOrders)
    .where(eq(paymentOrders.id, orderId))
    .limit(1);
  if (!order) return billing("?payment=failed");

  if (order.period !== "monthly" && order.period !== "annual") {
    return billing("?payment=failed");
  }
  const period: Period = order.period;

  const verify = await verifyPayment(params);
  const now = new Date();

  if (!verify.ok) {
    await db
      .update(paymentOrders)
      .set({ status: "failed", rawResponse: verify.raw })
      .where(eq(paymentOrders.id, orderId));
    await logEvent({
      source: "auth",
      event: "subscription_payment_failed",
      message: `Paiement HYP refusé (order ${orderId}, ccode ${verify.ccode ?? "?"})`,
      level: "warn",
      userId: order.userId,
      metadata: { orderId, ccode: verify.ccode },
    });
    return billing("?payment=failed");
  }

  // Défense en profondeur : HYP renvoie l'Order qu'il a réellement validé.
  // S'il diffère de celui qu'on a chargé (depuis le param de query), on
  // refuse — la signature HYP lie déjà l'Order, ceci est une ceinture+bretelles
  // contre un éventuel rejeu inter-commandes.
  if (verify.raw.Order && verify.raw.Order !== orderId) {
    await db
      .update(paymentOrders)
      .set({ status: "failed", rawResponse: verify.raw })
      .where(eq(paymentOrders.id, orderId));
    await logEvent({
      source: "auth",
      event: "subscription_payment_rejected",
      message: `Order HYP incohérent (attendu ${orderId}, reçu ${verify.raw.Order})`,
      level: "warn",
      userId: order.userId,
      metadata: { orderId, returnedOrder: verify.raw.Order },
    });
    return billing("?payment=failed");
  }

  const check = validateHypReturn(
    {
      expectedAmount: order.expectedAmount,
      coin: order.coin,
      status: order.status,
      expiresAt: order.expiresAt,
    },
    verify.raw,
    now,
  );

  if (check.reason === "already_paid") {
    // Idempotent : la commande est déjà payée, rien à refaire.
    return billing("?paid=1");
  }

  if (!check.ok) {
    await db
      .update(paymentOrders)
      .set({ status: "failed", rawResponse: verify.raw })
      .where(eq(paymentOrders.id, orderId));
    await logEvent({
      source: "auth",
      event: "subscription_payment_rejected",
      message: `Validation paiement HYP échouée (order ${orderId}) : ${check.reason ?? "?"}`,
      level: "warn",
      userId: order.userId,
      metadata: { orderId, reason: check.reason },
    });
    return billing("?payment=failed");
  }

  const txnId = verify.raw.Id ?? null;

  try {
    const result = await db.transaction(async (tx) => {
      const [order2] = await tx
        .select({ status: paymentOrders.status })
        .from(paymentOrders)
        .where(eq(paymentOrders.id, order.id))
        .for("update");
      if (order2?.status === "paid") {
        return { already: true };
      }

      const [user] = await tx
        .select({ paidUntil: users.paidUntil })
        .from(users)
        .where(eq(users.id, order.userId))
        .limit(1);

      const newPaidUntil = nextPaidUntil(user?.paidUntil, now, period);

      await tx
        .update(users)
        .set({
          subscriptionStatus: "active",
          subscriptionPlan: order.planKey,
          paidUntil: newPaidUntil,
          trialEndsAt: null,
          trialWarningSentAt: null,
          deletionLockedUntil: null,
        })
        .where(eq(users.id, order.userId));

      await tx
        .update(paymentOrders)
        .set({
          status: "paid",
          paidAt: now,
          hypTransactionId: txnId,
          rawResponse: verify.raw,
        })
        .where(eq(paymentOrders.id, order.id));

      return { already: false };
    });

    if (result.already) {
      return billing("?paid=1");
    }
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const msg = err instanceof Error ? err.message : String(err);
    if (
      code === "23505" ||
      msg.includes("hyp_transaction_id") ||
      msg.includes("duplicate")
    ) {
      // La transaction HYP a déjà servi pour une autre commande : replay.
      await logEvent({
        source: "auth",
        event: "subscription_payment_duplicate",
        message: `Transaction HYP déjà utilisée (order ${orderId}, txn ${txnId ?? "?"})`,
        level: "warn",
        userId: order.userId,
        metadata: { orderId, txnId },
      });
      return billing("?payment=failed");
    }
    throw err;
  }

  await logEvent({
    source: "auth",
    event: "subscription_paid",
    message: `Abonnement activé (${order.planKey} / ${order.period}) pour user ${order.userId}`,
    userId: order.userId,
    metadata: {
      plan: order.planKey,
      period: order.period,
      amount: order.expectedAmount,
      currency: order.currency,
      txnId,
    },
  });

  return billing("?paid=1");
}
