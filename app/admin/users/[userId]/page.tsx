import { and, eq, gte, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";

import frMessages from "@/messages/fr.json";

import { auth, signOut } from "@/auth";
import { IdleWatcher } from "@/components/IdleWatcher";
import { Logo } from "@/components/ui/Logo";
import { DEFAULT_PROMPT_BLOCK_ORDER } from "@/lib/agent-prompt-defaults";
import { buildAgentPromptPreview } from "@/lib/agent-prompt-preview";
import { db } from "@/lib/db";
import {
  agentConfigs,
  calls,
  phoneNumbers,
  users,
} from "@/lib/db/schema";
import { PLANS, type PlanKey } from "@/lib/plans";
import {
  getConfigBlocksDirectiveByPlan,
  getGlobalInstructionsByPlan,
  getHangupDirectiveByPlan,
  getPerCallContextTemplateByPlan,
  getPromptBlockOrderByPlan,
  getSpokenPhoneDirectiveByPlan,
  getSpokenTimeDirectiveByPlan,
} from "@/lib/settings";

import { ConfigForm } from "@/app/[locale]/dashboard/config-form";

export const dynamic = "force-dynamic";

// Admin tenant view = même ConfigForm que le dashboard utilisateur, mais
// scopé sur le tenant cible. Toutes les saves passent par
// /api/admin/configs/{userId} via la prop asUserId.
//
// L'admin voit donc *exactement* ce que le tenant voit (hero + stats +
// tuiles Persona/Voice/Knowledge/Notifs + LiveTest sticky), avec en plus
// les capacités admin (isAdmin=true) là où ConfigForm les expose.
export default async function AdminTenantPage({
  params,
}: {
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
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) {
    return (
      <main className="mx-auto w-full max-w-5xl p-12">
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
    );
  }

  const [config] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId))
    .limit(1);

  if (!config) {
    return (
      <main className="mx-auto w-full max-w-5xl p-12">
        <Link
          href="/admin"
          className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          ← Admin
        </Link>
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Ce tenant n&apos;a pas encore de config agent.
        </div>
      </main>
    );
  }

  const planKey: PlanKey =
    target.subscriptionPlan && PLANS.some((p) => p.key === target.subscriptionPlan)
      ? (target.subscriptionPlan as PlanKey)
      : PLANS[0].key;
  const planLabel = PLANS.find((p) => p.key === planKey)?.name ?? planKey;

  const [primaryPhone] = await db
    .select({ phoneNumber: phoneNumbers.phoneNumber })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, userId))
    .limit(1);

  const lastUpdated = new Date(config.updatedAt).toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  });

  // Stats target tenant — mêmes calculs que le dashboard user, mais sur
  // calls.userId = target.id (au lieu de session.user.id). Permet à
  // l'admin de voir les vrais chiffres du tenant en bandeau hero.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  );
  const stats = await (async () => {
    const [todayRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(calls)
      .where(and(eq(calls.userId, userId), gte(calls.createdAt, startOfToday)));
    const [monthRow] = await db
      .select({
        totalSeconds: sql<number>`coalesce(sum(jsonb_array_length(transcript)) * 6, 0)::int`,
      })
      .from(calls)
      .where(and(eq(calls.userId, userId), gte(calls.createdAt, startOfMonth)));
    const [totalRow] = await db
      .select({
        count: sql<number>`count(*)::int`,
        withSummary: sql<number>`count(*) filter (where length(summary) > 0)::int`,
        rdv: sql<number>`count(*) filter (where summary ~* 'rdv|rendez-vous|appointment|תור')::int`,
        avgBubbles: sql<number>`coalesce(avg(jsonb_array_length(transcript)), 0)::float`,
      })
      .from(calls)
      .where(eq(calls.userId, userId));
    const total = totalRow?.count ?? 0;
    const withSummary = totalRow?.withSummary ?? 0;
    const conversion = total > 0 ? Math.round((withSummary / total) * 100) : 0;
    const avgSeconds = Math.round((totalRow?.avgBubbles ?? 0) * 6);
    const avgMin = Math.floor(avgSeconds / 60);
    const avgSec = avgSeconds % 60;
    const avgDuration =
      avgSeconds === 0
        ? "—"
        : `${avgMin}m${avgSec.toString().padStart(2, "0")}`;
    const monthSeconds = monthRow?.totalSeconds ?? 0;
    return {
      callsToday: todayRow?.count ?? 0,
      conversion,
      avgDuration,
      rdv: totalRow?.rdv ?? 0,
      minutesThisMonth: Math.round(monthSeconds / 60),
    };
  })();

  // Preview des blocs admin hérités pour le popup info "Héritage admin".
  const [
    globalByPlan,
    spokenTimeByPlan,
    spokenPhoneByPlan,
    hangupByPlan,
    perCallContextByPlan,
    configBlocksByPlan,
    blockOrderByPlan,
  ] = await Promise.all([
    getGlobalInstructionsByPlan(),
    getSpokenTimeDirectiveByPlan(),
    getSpokenPhoneDirectiveByPlan(),
    getHangupDirectiveByPlan(),
    getPerCallContextTemplateByPlan(),
    getConfigBlocksDirectiveByPlan(),
    getPromptBlockOrderByPlan(),
  ]);
  const promptBlocksPreview = buildAgentPromptPreview({
    config,
    globalForPlan: globalByPlan[planKey] ?? "",
    planKey,
    spokenTime: spokenTimeByPlan[planKey] ?? "",
    spokenPhone: spokenPhoneByPlan[planKey] ?? "",
    hangup: hangupByPlan[planKey] ?? "",
    perCallContextTemplate: perCallContextByPlan[planKey] ?? "",
    configBlocks: configBlocksByPlan[planKey] ?? "",
    blockOrder: blockOrderByPlan[planKey] ?? [...DEFAULT_PROMPT_BLOCK_ORDER],
  });
  const ADMIN_INHERIT_BLOCKS = new Set([
    "spoken_time",
    "spoken_phone",
    "hangup",
    "per_call_context",
    "config_blocks",
    "admin_global",
  ]);
  const adminInheritablePreview = promptBlocksPreview
    .filter((b) => ADMIN_INHERIT_BLOCKS.has(b.id))
    .map((b) => `═══ ${b.label} ═══\n\n${b.content}`)
    .join("\n\n");

  async function handleLogout() {
    "use server";
    await signOut({ redirect: false });
    redirect("/");
  }

  return (
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <main className="min-h-screen">
        <IdleWatcher />
        <header className="sticky top-0 z-40 border-b border-[var(--color-border)]/60 bg-white/85 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
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
                Vue admin · {target.email}
              </span>
              <Link
                href={`/admin/users/${target.id}/logs`}
                className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] shadow-xs transition-colors hover:bg-[var(--color-muted)]"
              >
                📊 Logs
              </Link>
              <form action={handleLogout}>
                <button className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] shadow-xs transition-colors hover:bg-[var(--color-muted)]">
                  Déconnexion
                </button>
              </form>
            </div>
          </div>
        </header>

        {/* Bandeau de contexte : indique clairement que l'admin agit
         *  au nom de ce tenant. Évite la confusion entre "ma vue admin"
         *  et "vue admin du tenant X". */}
        <div className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6 sm:pt-8">
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

        <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-4 sm:px-6">
          <ConfigForm
            initial={{
              instructions: config.instructions,
              greetingInstructions: config.greetingInstructions,
              model: config.model,
              voice: config.voice,
              temperature: config.temperature,
              speed: config.speed,
              maxResponseTokens: config.maxResponseTokens,
              ownerWhatsapp: config.ownerWhatsapp,
              primaryLanguage: config.primaryLanguage ?? "fr",
              inheritAdminGlobals: config.inheritAdminGlobals ?? true,
              personality: config.personality ?? {},
              agentName: config.agentName ?? "",
              noiseReductionLevel: config.noiseReductionLevel ?? 8,
              knowledge: Array.isArray(config.knowledge) ? config.knowledge : [],
            }}
            isAdmin={true}
            adminInheritablePreview={adminInheritablePreview}
            planLabel={planLabel}
            primaryPhone={primaryPhone?.phoneNumber ?? null}
            lastUpdatedLabel={lastUpdated}
            stats={stats}
            asUserId={target.id}
          />
        </div>
      </main>
    </NextIntlClientProvider>
  );
}
