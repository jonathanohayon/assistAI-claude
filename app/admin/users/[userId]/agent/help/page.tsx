import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { AgentHelpView } from "@/components/agent-help/AgentHelpView";
import { requireAdminPage } from "@/lib/auth/require-admin-page";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { clientAgentEnabled, clientAgentMode } from "@/lib/tools/client-agent-switch";

export const dynamic = "force-dynamic";

// Admin tenant view of "Comment obtenir l'adresse de votre agent": the SAME
// content as the tenant's page, for the TENANT viewed (in French, like the
// rest of the admin). Its test sends ?asUserId=<tenant> to the existing
// routes, so it acts on that tenant, never on the admin's own account; the
// test opens on that TENANT's CLIENT_AGENT result (as the admin Connect page,
// and as the test route itself decides). Gate: requireAdminPage.
export default async function AdminTenantAgentHelpPage(props: { params: Promise<{ userId: string }> }) {
  await requireAdminPage();
  const { userId } = await props.params;
  const [[target], [cfg]] = await Promise.all([
    db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1),
    // The test question's language: the TENANT's, as the test route picks it.
    db.select({ primaryLanguage: agentConfigs.primaryLanguage }).from(agentConfigs).where(eq(agentConfigs.userId, userId)).limit(1),
  ]);
  if (!target) redirect("/admin");
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6">
      <AgentHelpView locale="fr" testOpen={clientAgentEnabled(clientAgentMode(), target.role === "admin")} asUserId={userId}
        testLanguage={cfg?.primaryLanguage ?? null}
      />
    </main>
  );
}
