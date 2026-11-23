import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ConnectPageContent } from "@/app/[locale]/dashboard/agent/connect-view";
import { requireAdminPage } from "@/lib/auth/require-admin-page";
import { connectPageView } from "@/lib/connect-page-view";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { loadProductPage } from "@/lib/product-gates";
import { clientAgentEnabled, clientAgentMode } from "@/lib/tools/client-agent-switch";

export const dynamic = "force-dynamic";

// Admin tenant view, menu entry "Connecter votre agent" (connect): the SAME
// decision as the tenant's own page (lib/connect-page-view.ts), from the
// TENANT's menu and the TENANT's CLIENT_AGENT result, the viewer being an
// admin: the client-agent brick scoped with asUserId where it can show for
// that account; otherwise the closed product's preview (header, no
// "Prévenez-moi", the admin line, the sample brick). Never a title alone. The
// title is the product's one name key (DashboardNav.connect), in French like
// the rest of the admin. Gate: requireAdminPage.
export default async function AdminTenantConnectPage(props: { params: Promise<{ userId: string }> }) {
  await requireAdminPage();
  const { userId } = await props.params;
  const t = await getTranslations({ locale: "fr", namespace: "DashboardNav" });
  const [target] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (!target) redirect("/admin");
  const { menu, trials, trialTerms } = await loadProductPage(userId);
  const view = connectPageView({
    menu: menu.connect,
    showClientAgent: clientAgentEnabled(clientAgentMode(), target.role === "admin"),
    isAdmin: true,
  });
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6">
      <ConnectPageContent view={view} title={t("connect")} trial={trials.connect} trialTerms={trialTerms} asUserId={userId} />
    </main>
  );
}
