import { TenantConfigPage } from "../config/config-page";

/**
 * Menu entry "Mon agent": the bricks every product shares, never copied per
 * product (voice, persona, what the agent knows, what it can do), with the
 * live test. The gate is TenantConfigPage's (signed-in tenant, own config).
 */
export default async function MyAgentPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return <TenantConfigPage locale={locale} section="agent" />;
}
