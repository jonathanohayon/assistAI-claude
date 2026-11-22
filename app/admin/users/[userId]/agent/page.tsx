import { AdminTenantConfigPage } from "../admin-config-page";

export const dynamic = "force-dynamic";

// Admin tenant view, menu entry "Votre agent": the tools tile, whose "Ask
// your agent" row holds the tenant's agent address and its test, scoped with
// asUserId. (The tenant's "who answers" and public-URL cards have no admin
// mode yet: they are on the tenant's own page only.) Gate: requireAdminPage.
export default async function AdminTenantConnectPage(props: { params: Promise<{ userId: string }> }) {
  const { userId } = await props.params;
  return <AdminTenantConfigPage userId={userId} section="connect" />;
}
