import { AdminTenantCalendarSection } from "./calendar-section";
import { AdminTenantContactsSection } from "./contacts-section";

export const dynamic = "force-dynamic";

// Admin tenant view, menu entry "Clients": the tenant's calendar and contacts
// (formerly /calendar and /contacts, which redirect here). Gate:
// requireAdminPage (in each section and the layout).
export default async function AdminTenantClientsPage(props: { params: Promise<{ userId: string }> }) {
  const { userId } = await props.params;
  return (
    <main>
      <AdminTenantCalendarSection userId={userId} />
      <AdminTenantContactsSection userId={userId} />
    </main>
  );
}
