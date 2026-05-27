import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";

import frMessages from "@/messages/fr.json";

import { auth, signOut } from "@/auth";
import { AuroraBackground } from "@/components/AuroraBackground";
import { IdleWatcher } from "@/components/IdleWatcher";
import { Logo } from "@/components/ui/Logo";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { PLANS, type PlanKey } from "@/lib/plans";

import { AdminTenantTabs } from "./_nav";

// Layout partagé pour /admin/users/[userId]/* — fournit header + nav 4
// onglets (Config / Calendrier / CRM / Monitoring) pour que l'admin puisse
// naviguer dans les vues du tenant comme le tenant le ferait sur son
// /dashboard. Mirror minimal du dashboard layout sans i18n switcher
// (admin fr-only) ni trial banner.
export default async function AdminTenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ userId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [me] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!me || me.role !== "admin") redirect("/dashboard");

  const { userId } = await params;
  const [target] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      subscriptionPlan: users.subscriptionPlan,
      subscriptionStatus: users.subscriptionStatus,
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
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4">
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
        <div className="relative z-10 mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 sm:pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#fde68a] bg-[#fef3c7]/60 px-4 py-2.5 text-xs text-[#92400e]">
            <span>
              👁 Vue admin du tenant{" "}
              <strong className="font-semibold">
                {target.displayName || target.email}
              </strong>{" "}
              · plan {planLabel} · statut {target.subscriptionStatus}
            </span>
            <span className="font-mono">{target.id.slice(0, 8)}…</span>
          </div>
        </div>

        <AdminTenantTabs userId={target.id} />

        <div className="relative z-10">{children}</div>
      </div>
    </NextIntlClientProvider>
  );
}
