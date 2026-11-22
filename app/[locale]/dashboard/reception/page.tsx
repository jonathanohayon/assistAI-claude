import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ProductPreviewHeader } from "@/components/dashboard/ProductPreviewHeader";
import { loadAccountProductMenu } from "@/lib/product-gates";

import { TenantConfigPage } from "../config/config-page";

/**
 * Menu entry "Réception": today's home overview (setup checklist, number,
 * stats, live test) and what is specific to reception (notifications,
 * channels). The call forwarding wizard is its sub-page (./forwarding).
 * Not owned (menu preview): the product's header first, instead of the
 * generic tile-grid heading. The gate is TenantConfigPage's.
 */
export default async function ReceptionPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);
  const state = (await loadAccountProductMenu(session.user.id)).reception;
  if (state.state === "preview") {
    return (
      <TenantConfigPage
        locale={locale}
        section="reception"
        gridHeading={false}
        before={<ProductPreviewHeader entry="reception" cta={state.cta} />}
      />
    );
  }
  return <TenantConfigPage locale={locale} section="reception" />;
}
