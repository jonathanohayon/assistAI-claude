import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { featuresForPlan } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";

import { CampaignsPageClient } from "./campaigns-page-client";

/**
 * Onglet « Appels sortants » (centre d'appels IA). Visible dans la nav
 * uniquement quand la feature `outbound_campaigns` est active (plan premium)
 * ou pour un admin — même règle de gating que `DashboardTabs`. On reproduit
 * le contrôle ici pour qu'un accès direct à l'URL par un plan non éligible
 * retombe sur la config entrante.
 */
export default async function CampaignsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);

  const [me] = await db
    .select({ role: users.role, subscriptionPlan: users.subscriptionPlan })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const isAdmin = me?.role === "admin";
  const features = featuresForPlan(
    await getPlanFeatureMatrix(),
    me?.subscriptionPlan,
  );
  const enabled = isAdmin || features.outbound_campaigns === true;
  if (!enabled) redirect(`/${locale}/dashboard`);

  return (
    <main className="pb-6">
      <CampaignsPageClient />
    </main>
  );
}
