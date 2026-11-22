import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ProductPreviewHeader } from "@/components/dashboard/ProductPreviewHeader";
import { ReceptionPreview } from "@/components/preview/ReceptionPreview";
import { loadAccountProductMenu } from "@/lib/product-gates";

import { TenantConfigPage } from "../config/config-page";

/**
 * Menu entry "Réception": today's home overview (setup checklist, number,
 * stats, live test) and what is specific to reception (notifications,
 * channels). The call forwarding wizard is its sub-page (./forwarding).
 * Not owned (menu preview): the product's header, then the same overview
 * read-only over sample data (ReceptionPreview: a sample number and figures,
 * a static live test that never opens a session, no request). The owned
 * page's gate is TenantConfigPage's.
 */
export default async function ReceptionPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);
  const state = (await loadAccountProductMenu(session.user.id)).reception;
  if (state.state === "preview") {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 sm:px-6 sm:pt-8">
        <ProductPreviewHeader entry="reception" cta={state.cta} />
        <ReceptionPreview />
      </main>
    );
  }
  return <TenantConfigPage locale={locale} section="reception" />;
}
