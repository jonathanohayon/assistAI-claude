import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requireAdminPage } from "@/lib/auth/require-admin-page";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { featuresForPlan } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import { accountProductMenu } from "@/lib/product-gates";

export const dynamic = "force-dynamic";

// Admin tenant view, menu entry "Centre d'appels" (sales). The outbound call centre has no
// admin-on-tenant mode (its API scopes to the session user), so this page
// says what the TENANT sees for it, computed like the tenant's own menu.
// Admin-only page: French, like the rest of /admin; the product's name is its
// one key (DashboardNav.sales), read in French. Gate: requireAdminPage.
export default async function AdminTenantSalesPage(props: { params: Promise<{ userId: string }> }) {
  await requireAdminPage();
  const { userId } = await props.params;
  const t = await getTranslations({ locale: "fr", namespace: "DashboardNav" });
  const [target] = await db
    .select({ role: users.role, subscriptionPlan: users.subscriptionPlan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) redirect("/admin");
  const menu = await accountProductMenu(userId, target.role, featuresForPlan(await getPlanFeatureMatrix(), target.subscriptionPlan));
  const s = menu.sales;
  const state =
    s.state === "owned" ? "possédé (utilisable)" : s.cta === "soon" ? "aperçu « Bientôt »" : "aperçu « Essai gratuit »";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6">
      <div className="rounded-2xl border border-[var(--color-border)] bg-white p-6 text-sm text-[var(--color-muted-foreground)]">
        <h1 className="font-display text-lg text-[var(--color-foreground)]">{t("sales")}</h1>
        <p className="mt-2">
          Les campagnes du tenant ne sont pas consultables depuis la vue admin. Dans son menu, {t("sales")} apparaît en{" "}
          <strong className="text-[var(--color-foreground)]">{state}</strong>.
        </p>
      </div>
    </main>
  );
}
