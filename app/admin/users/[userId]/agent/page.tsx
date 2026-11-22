import { ClientAgentBrick } from "@/components/bricks/client-agent/ClientAgentBrick";
import { requireAdminPage } from "@/lib/auth/require-admin-page";

export const dynamic = "force-dynamic";

// Admin tenant view, menu entry "Votre agent": the client-agent brick ("Ask
// your agent": the tenant's agent address and its test), scoped with
// asUserId; it shows only where the server says the TENANT may use it
// (clientAgentTool.visible for that account). (The tenant's "who answers"
// and public-URL cards have no admin mode yet: they are on the tenant's own
// page only.) Gate: requireAdminPage.
export default async function AdminTenantConnectPage(props: { params: Promise<{ userId: string }> }) {
  await requireAdminPage();
  const { userId } = await props.params;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6">
      <h1 className="mb-5 font-display text-2xl tracking-tight text-[var(--color-foreground)]">Votre agent</h1>
      <ClientAgentBrick asUserId={userId} />
    </main>
  );
}
