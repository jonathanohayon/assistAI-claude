import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { captureMode } from "@/lib/campaigns/capture-mode";
import { loadOutboundCampaignsAccess } from "@/lib/campaigns/plan-gate";

import { CampaignsPageClient } from "../campaigns/campaigns-page-client";
import { TenantConfigPage } from "../config/config-page";

/**
 * Menu entry "Ventes" (sales): the outbound call centre (campaigns and their
 * results), formerly /dashboard/campaigns (which redirects here). Same gate
 * as the API (lib/campaigns/plan-gate.ts): an account that may not use it
 * gets today's locked state instead, i.e. the locked campaigns tile and its
 * upsell (what /dashboard showed it before the menu).
 */
export default async function SalesPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);

  // Same helper as the API gate (lib/campaigns/plan-gate.ts).
  const { isAdmin, enabled } = await loadOutboundCampaignsAccess(session.user.id);
  if (!enabled) return <TenantConfigPage locale={locale} section="sales" />;

  return (
    <main className="pb-6">
      {/* Capture switch: one boolean to the client; the env stays server-side. */}
      <CampaignsPageClient isAdmin={isAdmin} captureOn={captureMode() === "on"} />
    </main>
  );
}
