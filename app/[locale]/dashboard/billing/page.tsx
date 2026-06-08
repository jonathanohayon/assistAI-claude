import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getLocalizedPlan } from "@/lib/plan-i18n";
import { getPlanPricingMap } from "@/lib/plan-pricing-storage";
import { DEFAULT_PLAN_KEY, PLANS, isValidPlanKey } from "@/lib/plans";

import { BillingClient } from "./client";

export const dynamic = "force-dynamic";

export default async function BillingPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ plan?: string; billing?: string }>;
}) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);

  const { plan: hintedPlan, billing: hintedBilling } = await props.searchParams;

  const [me] = await db
    .select({ subscriptionPlan: users.subscriptionPlan })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const currentPlanKey = isValidPlanKey(me?.subscriptionPlan)
    ? me.subscriptionPlan
    : DEFAULT_PLAN_KEY;

  const currentPlan = getLocalizedPlan(locale, currentPlanKey);
  const hintedPlanKey = isValidPlanKey(hintedPlan) ? hintedPlan : null;
  const pricing = await getPlanPricingMap();

  const t = await getTranslations({ locale, namespace: "DashboardBilling" });

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
          {t("header")}
        </p>
        <h1 className="font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
          {t("title")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
          {t.rich("currentSubtitle", {
            planName: currentPlan.name,
            strong: (chunks) => (
              <span className="font-semibold text-[var(--color-foreground)]">
                {chunks}
              </span>
            ),
          })}
        </p>
      </div>

      <BillingClient
        plans={[...PLANS]}
        pricing={pricing}
        currentPlanKey={currentPlanKey}
        hintedPlanKey={hintedPlanKey}
        initialBilling={hintedBilling === "annual" ? "annual" : "monthly"}
        email={session.user.email ?? ""}
      />
    </div>
  );
}
