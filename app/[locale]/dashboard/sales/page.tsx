import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ProductPreviewHeader } from "@/components/dashboard/ProductPreviewHeader";
import { SalesPreview } from "@/components/preview/SalesPreview";
import { captureMode } from "@/lib/campaigns/capture-mode";
import { loadOutboundCampaignsAccess } from "@/lib/campaigns/plan-gate";
import { loadProductPage } from "@/lib/product-gates";

import { CampaignsPageClient } from "../campaigns/campaigns-page-client";
import { TenantConfigPage } from "../config/config-page";

/**
 * Menu entry "Centre d'appels" (sales): the outbound call centre (campaigns and their
 * results), formerly /dashboard/campaigns (which redirects here). Same gate
 * as the API (lib/campaigns/plan-gate.ts).
 *   - Not owned (menu preview): the product's own header (name, what it does,
 *     its one button), then the real campaigns workspace read-only over
 *     sample data (SalesPreview: no request, no write). The locked campaigns
 *     tile is not repeated under it: it said the same thing.
 *   - Owned but not usable (cannot happen with today's gates): today's locked
 *     tile and its upsell.
 */
export default async function SalesPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);

  // Same helper as the API gate (lib/campaigns/plan-gate.ts).
  const { isAdmin, enabled } = await loadOutboundCampaignsAccess(session.user.id);
  const { menu, notifyRequested } = await loadProductPage(session.user.id);
  const state = menu.sales;
  if (state.state === "preview") {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 sm:px-6 sm:pt-8">
        <ProductPreviewHeader entry="sales" cta={state.cta} notifyRequested={notifyRequested.includes("sales")} />
        <SalesPreview />
      </main>
    );
  }

  if (!enabled) return <TenantConfigPage locale={locale} section="sales" />;

  return (
    <main className="pb-6">
      {/* Capture switch: one boolean to the client; the env stays server-side. */}
      <CampaignsPageClient isAdmin={isAdmin} captureOn={captureMode() === "on"} />
    </main>
  );
}
