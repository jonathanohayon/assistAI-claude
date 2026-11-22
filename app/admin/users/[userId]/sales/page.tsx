import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { requireAdminPage } from "@/lib/auth/require-admin-page";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { featuresForPlan } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import { accountProductMenu } from "@/lib/product-gates";

export const dynamic = "force-dynamic";

// Admin tenant view, menu entry "Ventes". The outbound call centre has no
// admin-on-tenant mode (its API scopes to the session user), so this page
// says what the TENANT sees for it, computed like the tenant's own menu.
// Admin-only page: French, no i18n, like the rest of /admin. Gate: requireAdminPage.
export default async function AdminTenantSalesPage(props: { params: Promise<{ userId: string }> }) {
  await requireAdminPage();
  const { userId } = await props.params;
  const [target] = await db
    .select({ role: users.role, subscriptionPlan: users.subscriptionPlan, subscriptionStatus: users.subscriptionStatus })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) redirect("/admin");
  const menu = accountProductMenu(target, featuresForPlan(await getPlanFeatureMatrix(), target.subscriptionPlan));
  const s = menu.sales;
  const state =
    s.state === "owned" ? "possédé (utilisable)" : s.cta === "soon" ? "aperçu « Bientôt »" : "aperçu « Essai gratuit »";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6">
      <div className="rounded-2xl border border-[var(--color-border)] bg-white p-6 text-sm text-[var(--color-muted-foreground)]">
        <h1 className="font-display text-lg text-[var(--color-foreground)]">Ventes</h1>
        <p className="mt-2">
          Les campagnes du tenant ne sont pas consultables depuis la vue admin. Dans son menu, Ventes apparaît en{" "}
          <strong className="text-[var(--color-foreground)]">{state}</strong>.
        </p>
      </div>
    </main>
  );
}
