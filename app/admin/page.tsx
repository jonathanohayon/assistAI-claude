import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/auth";
import { IdleWatcher } from "@/components/IdleWatcher";
import { Logo } from "@/components/ui/Logo";
import { db } from "@/lib/db";
import { phoneNumbers, users } from "@/lib/db/schema";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import { getPlanPricingMap } from "@/lib/plan-pricing-storage";
import {
  getConfigBlocksDirectiveByPlan,
  getGlobalInstructionsByPlan,
  getGreetingFallbackTemplateByPlan,
  getHangupDirectiveByPlan,
  getOnboardingTemplateByPlan,
  getPerCallContextTemplateByPlan,
  getPromptBlockOrderByPlan,
  getSpokenPhoneDirectiveByPlan,
  getSpokenTimeDirectiveByPlan,
  getSummaryPromptByPlan,
} from "@/lib/settings";

import { AdminShell } from "./admin-shell";
import { requireAdminPage } from "@/lib/auth/require-admin-page";

export default async function AdminPage() {
  const me = await requireAdminPage();

  const allUsers = await db
    .select()
    .from(users)
    .orderBy(users.createdAt);
  const allNumbers = await db.select().from(phoneNumbers);
  const [
    globalInstructionsByPlan,
    onboardingTemplateByPlan,
    summaryPromptByPlan,
    planFeatures,
    planPricing,
    spokenTimeByPlan,
    spokenPhoneByPlan,
    hangupByPlan,
    perCallContextByPlan,
    configBlocksByPlan,
    promptBlockOrderByPlan,
    greetingFallbackByPlan,
  ] = await Promise.all([
    getGlobalInstructionsByPlan(),
    getOnboardingTemplateByPlan(),
    getSummaryPromptByPlan(),
    getPlanFeatureMatrix(),
    getPlanPricingMap(),
    getSpokenTimeDirectiveByPlan(),
    getSpokenPhoneDirectiveByPlan(),
    getHangupDirectiveByPlan(),
    getPerCallContextTemplateByPlan(),
    getConfigBlocksDirectiveByPlan(),
    getPromptBlockOrderByPlan(),
    getGreetingFallbackTemplateByPlan(),
  ]);

  // Group numbers per user.
  const byUser = new Map<string, typeof allNumbers>();
  for (const n of allNumbers) {
    const list = byUser.get(n.userId) ?? [];
    list.push(n);
    byUser.set(n.userId, list);
  }

  const rows = allUsers.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    subscriptionPlan: u.subscriptionPlan,
    subscriptionStatus: u.subscriptionStatus,
    createdAt: u.createdAt,
    numbers: byUser.get(u.id) ?? [],
  }));

  async function handleLogout() {
    "use server";
    await signOut({ redirect: false });
    redirect("/");
  }

  return (
    <main className="min-h-screen">
      <IdleWatcher />
      <header className="sticky top-0 z-40 border-b border-[var(--color-border)]/60 bg-white/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Logo />
            </Link>
            <span className="hidden h-4 w-px bg-[var(--color-border)] sm:block" />
            <p className="hidden text-sm text-[var(--color-muted-foreground)] sm:block">
              Admin · gestion des tenants
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              Mon dashboard
            </Link>
            <span className="hidden text-xs text-[var(--color-muted-foreground)] sm:inline">
              {me.email}
            </span>
            <form action={handleLogout}>
              <button className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] shadow-xs transition-colors hover:bg-[var(--color-muted)]">
                Déconnexion
              </button>
            </form>
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-6 pt-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
          Admin
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
          Console d&apos;administration
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
          Deux niveaux de configuration : les <strong>réglages partagés</strong>{" "}
          en haut (s&apos;appliquent à tous les tenants) et la{" "}
          <strong>configuration par tenant</strong> en bas (assigner numéros,
          éditer la persona, choisir le modèle).
        </p>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 pb-20 pt-8">
        <AdminShell
          globalInstructionsByPlan={globalInstructionsByPlan}
          onboardingTemplateByPlan={onboardingTemplateByPlan}
          summaryPromptByPlan={summaryPromptByPlan}
          spokenTimeByPlan={spokenTimeByPlan}
          spokenPhoneByPlan={spokenPhoneByPlan}
          hangupByPlan={hangupByPlan}
          perCallContextByPlan={perCallContextByPlan}
          configBlocksByPlan={configBlocksByPlan}
          promptBlockOrderByPlan={promptBlockOrderByPlan}
          greetingFallbackByPlan={greetingFallbackByPlan}
          planFeatures={planFeatures}
          planPricing={planPricing}
          rows={rows}
          currentUserId={me.id}
        />
      </section>
    </main>
  );
}
