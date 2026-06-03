import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { paymentOrders, users } from "@/lib/db/schema";
import {
  CURRENCY_COIN,
  createPaymentUrl,
  currencyForLocale,
  pageLangFor,
} from "@/lib/hyp";
import { resolvePrice } from "@/lib/plan-pricing";
import { getPlanPricingMap } from "@/lib/plan-pricing-storage";
import { isValidPlanKey, planByKey } from "@/lib/plans";

// Crée une commande HYP pour le tenant courant et renvoie l'URL de paiement
// hébergée. On verrouille la suppression auto (deletionLockedUntil) 2h pour
// éviter une race avec le cron trial-cleanup pendant que l'utilisateur paie.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      plan?: string;
      period?: string;
    };
    const { plan, period } = body;

    if (!isValidPlanKey(plan)) {
      return NextResponse.json({ error: "invalid plan" }, { status: 400 });
    }
    if (period !== "monthly" && period !== "annual") {
      return NextResponse.json({ error: "invalid period" }, { status: 400 });
    }

    const [user] = await db
      .select({ locale: users.locale, email: users.email })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    if (!user) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const currency = currencyForLocale(user.locale);
    const coin = CURRENCY_COIN[currency];
    // Montant résolu côté serveur depuis la grille admin (jamais du client).
    const pricing = await getPlanPricingMap();
    const amount = resolvePrice(pricing, plan, period, currency);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);

    const [order] = await db
      .insert(paymentOrders)
      .values({
        userId: session.user.id,
        planKey: plan,
        period,
        currency,
        coin,
        expectedAmount: amount,
        status: "pending",
        expiresAt,
      })
      .returning({ id: paymentOrders.id });

    // Anti-race trial-cleanup : verrouille la suppression auto 2h le temps
    // que l'utilisateur finalise le paiement sur la page HYP.
    await db
      .update(users)
      .set({ deletionLockedUntil: new Date(now.getTime() + 2 * 60 * 60 * 1000) })
      .where(eq(users.id, session.user.id));

    const base = process.env.APP_URL;
    // Succès ET annulation passent par le callback : il casse l'iframe vers le
    // top-level (le paiement tourne dans une iframe popup).
    const successUrl = base + "/api/dashboard/hyp/callback?locale=" + user.locale;
    const cancelUrl =
      base + "/api/dashboard/hyp/callback?locale=" + user.locale + "&cancelled=1";
    const info = planByKey(plan).name + " (" + period + ")";

    const url = await createPaymentUrl({
      orderId: order.id,
      amount,
      coin,
      info,
      pageLang: pageLangFor(user.locale),
      successUrl,
      cancelUrl,
      email: user.email,
    });

    return NextResponse.json({ url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "payment creation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
