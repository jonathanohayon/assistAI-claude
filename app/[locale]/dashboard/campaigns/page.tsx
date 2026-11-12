import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { loadOutboundCampaignsAccess } from "@/lib/campaigns/plan-gate";

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

  // Same helper as the API gate (lib/campaigns/plan-gate.ts).
  const { isAdmin, enabled } = await loadOutboundCampaignsAccess(session.user.id);
  if (!enabled) redirect(`/${locale}/dashboard`);

  return (
    <main className="pb-6">
      <CampaignsPageClient isAdmin={isAdmin} />
    </main>
  );
}
