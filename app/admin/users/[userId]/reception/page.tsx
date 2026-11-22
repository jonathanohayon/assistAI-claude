import { AdminTenantConfigPage } from "../admin-config-page";

export const dynamic = "force-dynamic";

// Admin tenant view, menu entry Réception (number, stats, live test):
// the tenant's own page, scoped with asUserId. Gate: requireAdminPage (in
// AdminTenantConfigPage and the layout).
export default async function AdminTenantSectionPage(props: { params: Promise<{ userId: string }> }) {
  const { userId } = await props.params;
  return <AdminTenantConfigPage userId={userId} section="reception" />;
}
