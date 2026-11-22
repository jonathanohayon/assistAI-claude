import { TenantConfigPage } from "../config/config-page";

/**
 * Menu entry "Réception": today's home overview (setup checklist, number,
 * stats, live test) and what is specific to reception (notifications,
 * channels). The call forwarding wizard is its sub-page (./forwarding).
 * The gate is TenantConfigPage's (signed-in tenant, own config).
 */
export default async function ReceptionPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return <TenantConfigPage locale={locale} section="reception" />;
}
