import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";

import frMessages from "@/messages/fr.json";

import { signOut } from "@/auth";
import { AuroraBackground } from "@/components/AuroraBackground";
import { IdleWatcher } from "@/components/IdleWatcher";
import { Logo } from "@/components/ui/Logo";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { navBlocks } from "@/lib/dashboard-nav";
import { db } from "@/lib/db";
import { resolveDoor } from "@/lib/door";
import { users } from "@/lib/db/schema";
import { featuresForPlan } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import { accountProductNav } from "@/lib/product-gates";
import { productNames } from "@/lib/product-names";
import { PLANS, type PlanKey } from "@/lib/plans";
import { getDemoUserId } from "@/lib/settings";

import { CompanySheetResetControl } from "./CompanySheetResetControl";
import { DemoAccountToggle } from "./DemoAccountToggle";
import { EngineOverrideLine } from "./EngineOverrideLine";
import { PersonaResetControl } from "./PersonaResetControl";
import { PlanAccessControl } from "./PlanAccessControl";
import { requireAdminPage } from "@/lib/auth/require-admin-page";

// Layout partagé pour /admin/users/[userId]/* — fournit header + le MÊME menu
// que le dashboard du tenant (components/dashboard/DashboardSidebar, avec
// asUserId) pour que l'admin navigue dans les vues du tenant comme le tenant
// le ferait. The menu is computed for the TARGET tenant (its door, plan,
// status, features and the product gates), never for the admin. No i18n
// switcher (admin fr-only) nor trial banner.
export default async function AdminTenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ userId: string }>;
}) {
  await requireAdminPage();

  const { userId } = await params;
  const [target] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      subscriptionPlan: users.subscriptionPlan,
      subscriptionStatus: users.subscriptionStatus,
      paidUntil: users.paidUntil,
      door: users.door,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!target) {
    return (
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <main className="mx-auto w-full max-w-6xl p-12">
          <Link
            href="/admin"
            className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            ← Admin
          </Link>
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            Tenant introuvable.
          </div>
        </main>
      </NextIntlClientProvider>
    );
  }

  const planKey: PlanKey =
    target.subscriptionPlan && PLANS.some((p) => p.key === target.subscriptionPlan)
      ? (target.subscriptionPlan as PlanKey)
      : PLANS[0].key;
  const planLabel = PLANS.find((p) => p.key === planKey)?.name ?? planKey;
  const isDemo = (await getDemoUserId()) === target.id;
  const door = resolveDoor(target.door);
  const nav = await accountProductNav(target.id, target.role, featuresForPlan(await getPlanFeatureMatrix(), target.subscriptionPlan));
  const menuBlocks = navBlocks(door, nav.menu, target.id, nav.trials);
  // "Illimité gratuit" = actif avec paidUntil très lointain (>= 2090).
  const isUnlimited =
    target.subscriptionStatus === "active" &&
    !!target.paidUntil &&
    target.paidUntil.getFullYear() >= 2090;

  // The products' names: their one key each (DashboardNav.<entry>), in French.
  const names = await productNames("fr");

  async function handleLogout() {
    "use server";
    await signOut({ redirect: false });
    redirect("/");
  }

  return (
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <div className="relative min-h-screen">
        <AuroraBackground />
        <IdleWatcher />
        <header className="sticky top-0 z-40 border-b border-[var(--color-border)]/60 bg-white/85 backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Logo />
              </Link>
              <span className="hidden h-4 w-px bg-[var(--color-border)] sm:block" />
              <Link
                href="/admin"
                className="hidden text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] sm:block"
              >
                ← Admin
              </Link>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-[var(--color-muted-foreground)] sm:inline">
                {target.email}
              </span>
              <form action={handleLogout}>
                <button className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] shadow-xs transition-colors hover:bg-[var(--color-muted)]">
                  Déconnexion
                </button>
              </form>
            </div>
          </div>
        </header>

        {/* Bandeau jaune : indique clairement à l'admin qu'il agit sur
         *  un tenant. Présent sur toutes les sous-pages /admin/users/[id]/*. */}
        <div className="relative z-10 mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#fde68a] bg-[#fef3c7]/60 px-4 py-2.5 text-xs text-[#92400e]">
            <span>
              👁 Vue admin du tenant{" "}
              <strong className="font-semibold">
                {target.displayName || target.email}
              </strong>{" "}
              · plan {planLabel} · statut {target.subscriptionStatus}
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <PlanAccessControl
                userId={target.id}
                initialPlan={planKey}
                initialUnlimited={isUnlimited}
              />
              <DemoAccountToggle userId={target.id} initialIsDemo={isDemo} />
              <PersonaResetControl userId={target.id} />
              <CompanySheetResetControl userId={target.id} />
              <span className="font-mono">{target.id.slice(0, 8)}…</span>
            </div>
            <EngineOverrideLine userId={target.id} names={names} />
          </div>
        </div>

        <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col lg:flex-row lg:gap-6 lg:px-6">
          <DashboardSidebar blocks={menuBlocks} asUserId={target.id} />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </NextIntlClientProvider>
  );
}
