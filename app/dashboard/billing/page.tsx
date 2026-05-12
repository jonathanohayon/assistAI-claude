import { eq } from "drizzle-orm";
import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { getLocalizedPlan } from "@/lib/plan-i18n";
import {
  DEFAULT_PLAN_KEY,
  PLANS,
  isValidPlanKey,
} from "@/lib/plans";

import { BillingClient } from "./client";

export const dynamic = "force-dynamic";

export default async function BillingPage(props: {
  searchParams: Promise<{ plan?: string; billing?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { plan: hintedPlan, billing: hintedBilling } = await props.searchParams;

  const [me] = await db
    .select({
      subscriptionPlan: users.subscriptionPlan,
      subscriptionStatus: users.subscriptionStatus,
      trialEndsAt: users.trialEndsAt,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const currentPlanKey = isValidPlanKey(me?.subscriptionPlan)
    ? me.subscriptionPlan
    : DEFAULT_PLAN_KEY;

  // ─ Server action: switch plan. Stays as a no-op-billing change for now —
  //   real Stripe integration goes here when ready. We log the event so the
  //   admin can audit changes from /dashboard/logs.
  async function setPlan(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user?.id) redirect("/login");

    const next = String(formData.get("plan") ?? "");
    if (!isValidPlanKey(next)) {
      redirect("/dashboard/billing?error=invalid");
    }

    const [before] = await db
      .select({ subscriptionPlan: users.subscriptionPlan })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    if (before?.subscriptionPlan === next) {
      redirect(`/dashboard/billing?same=1`);
    }

    await db
      .update(users)
      .set({ subscriptionPlan: next })
      .where(eq(users.id, session.user.id));

    await logEvent({
      source: "auth",
      event: "subscription_plan_changed",
      message: `Plan : ${before?.subscriptionPlan ?? "?"} → ${next}`,
      userId: session.user.id,
      metadata: { from: before?.subscriptionPlan, to: next },
    });

    redirect(`/dashboard/billing?changed=${next}`);
  }

  const locale = await getLocale();
  const currentPlan = getLocalizedPlan(locale, currentPlanKey);
  const hintedPlanKey = isValidPlanKey(hintedPlan) ? hintedPlan : null;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
          Abonnement
        </p>
        <h1 className="font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
          Votre formule.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
          Vous êtes actuellement sur la formule{" "}
          <span className="font-semibold text-[var(--color-foreground)]">
            {currentPlan.name}
          </span>
          . Changez à tout moment, sans pénalité — la facturation est ajustée
          au prorata.
        </p>
      </div>

      <BillingClient
        plans={[...PLANS]}
        currentPlanKey={currentPlanKey}
        hintedPlanKey={hintedPlanKey}
        initialBilling={hintedBilling === "annual" ? "annual" : "monthly"}
        setPlanAction={setPlan}
      />

      <p className="mt-10 max-w-3xl text-xs text-[var(--color-muted-foreground)]">
        Les paiements sont gérés via Stripe (intégration en cours). Pendant
        l&apos;essai gratuit, le changement de formule est instantané et sans
        impact sur la facturation.
      </p>
    </div>
  );
}
