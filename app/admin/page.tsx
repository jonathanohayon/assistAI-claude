import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { IdleWatcher } from "@/components/IdleWatcher";
import { Logo } from "@/components/ui/Logo";
import { db } from "@/lib/db";
import { phoneNumbers, users } from "@/lib/db/schema";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
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

import { AdminTable } from "./admin-table";
import { BlockOrderForm } from "./block-order-form";
import { GlobalInstructionsForm } from "./global-instructions-form";
import { PlanFeaturesForm } from "./plan-features-form";
import { SystemDirectivesForm } from "./system-directives-form";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Gate: only admins.
  const [me] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!me || me.role !== "admin") redirect("/dashboard");

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

      <section className="mx-auto w-full max-w-6xl px-6 pt-10">
        <div className="rounded-3xl border-2 border-dashed border-[var(--color-primary)]/30 bg-[var(--color-primary)]/[0.03] p-6 sm:p-8">
          <div className="mb-5 flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                <path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </span>
            <div>
              <h2 className="font-display text-xl tracking-tight text-[var(--color-foreground)]">
                Réglages partagés (tous tenants)
              </h2>
              <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                Modifications visibles par <strong>tous les tenants existants
                et futurs</strong>. À utiliser pour les règles transverses (ton,
                anti-silence, format de réponse) et le squelette de persona
                proposé aux nouveaux comptes.
              </p>
            </div>
          </div>
          <GlobalInstructionsForm
            initialGlobalByPlan={globalInstructionsByPlan}
            initialTemplateByPlan={onboardingTemplateByPlan}
            initialSummaryPromptByPlan={summaryPromptByPlan}
          />
          <div className="mt-6">
            <SystemDirectivesForm
              initialByPlan={{
                spokenTime: spokenTimeByPlan,
                spokenPhone: spokenPhoneByPlan,
                hangup: hangupByPlan,
                perCallCtx: perCallContextByPlan,
                configBlocks: configBlocksByPlan,
                greetingFallback: greetingFallbackByPlan,
              }}
            />
          </div>
          <div className="mt-6">
            <BlockOrderForm initialOrderByPlan={promptBlockOrderByPlan} />
          </div>
          <div className="mt-6">
            <PlanFeaturesForm initialMatrix={planFeatures} />
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-10 pb-20">
        <div className="mb-5 flex items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-muted)] text-[var(--color-foreground)]">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM3 21v-1a6 6 0 0 1 6-6h6a6 6 0 0 1 6 6v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <h2 className="font-display text-xl tracking-tight text-[var(--color-foreground)]">
              Tenants individuels
            </h2>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              {rows.length} compte{rows.length > 1 ? "s" : ""} inscrit
              {rows.length > 1 ? "s" : ""}. Assigne un numéro pour router les
              appels vers sa config. Clique « Éditer » pour modifier sa
              persona, son modèle ou sa voix.
            </p>
          </div>
        </div>
        <AdminTable rows={rows} currentUserId={me.id} />
      </section>
    </main>
  );
}
