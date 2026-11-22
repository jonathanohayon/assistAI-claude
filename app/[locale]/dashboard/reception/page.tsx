import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ProductPreviewHeader } from "@/components/dashboard/ProductPreviewHeader";
import { ReceptionPreview } from "@/components/preview/ReceptionPreview";
import { loadProductPage } from "@/lib/product-gates";

import { TenantConfigPage } from "../config/config-page";

/**
 * Menu entry "Réception": today's home overview (setup checklist, number,
 * stats, live test). The channels and notifications tiles are on Mon agent
 * (they serve every product). The call forwarding wizard is its sub-page
 * (./forwarding).
 * Not owned (menu preview): the product's header, then the same overview
 * read-only over sample data (ReceptionPreview: a sample number and figures,
 * a static live test that never opens a session, no request). The owned
 * page's gate is TenantConfigPage's.
 */
export default async function ReceptionPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);
  const { menu, notifyRequested } = await loadProductPage(session.user.id);
  const state = menu.reception;
  if (state.state === "preview") {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 sm:px-6 sm:pt-8">
        <ProductPreviewHeader entry="reception" cta={state.cta} notifyRequested={notifyRequested.includes("reception")} />
        <ReceptionPreview />
      </main>
    );
  }
  return <TenantConfigPage locale={locale} section="reception" />;
}
