import { and, eq, gte, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { DEFAULT_PROMPT_BLOCK_ORDER } from "@/lib/agent-prompt-defaults";
import { buildAgentPromptPreview } from "@/lib/agent-prompt-preview";
import { db } from "@/lib/db";
import { agentConfigs, calls, phoneNumbers, users } from "@/lib/db/schema";
import { featuresForPlan } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
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

import { ConfigForm, DEFAULT_BUSINESS } from "./config-form";

export default async function DashboardPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);

  const [config] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, session.user.id))
    .limit(1);

  const [me] = await db
    .select({ role: users.role, subscriptionPlan: users.subscriptionPlan })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  const isAdmin = me?.role === "admin";
  const planKey: PlanKey =
    me?.subscriptionPlan && PLANS.some((p) => p.key === me.subscriptionPlan)
      ? (me.subscriptionPlan as PlanKey)
      : PLANS[0].key;
  const planLabel = PLANS.find((p) => p.key === planKey)?.name ?? planKey;

  // Matrice feature×plan → features actives pour ce tenant. Sert au gating
  // de la tuile "Centre d'appels sortant" (visible partout, activée premium).
  const planMatrix = await getPlanFeatureMatrix();
  const features = featuresForPlan(planMatrix, me?.subscriptionPlan);

  // Numéro Twilio principal du tenant — mis en avant en bandeau rose
  // gradient en haut du dashboard. Premier truc que le user voit après
  // login. Si pas de numéro (compte fraîchement créé pas encore en
  // onboarding/provision), on n'affiche pas la bannière du tout.
  const [primaryPhone] = await db
    .select({ phoneNumber: phoneNumbers.phoneNumber })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, session.user.id))
    .limit(1);

  const t = await getTranslations({ locale, namespace: "DashboardConfig" });

  if (!config) {
    return (
      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="rounded-2xl border border-[var(--color-border)] bg-white p-6 text-sm text-[var(--color-muted-foreground)]">
          {t("noConfigPre")}{" "}
          <code className="rounded bg-[var(--color-muted)] px-1.5 py-0.5 font-mono text-xs">
            npm run db:seed
          </code>{" "}
          {t("noConfigPost")}
        </div>
      </main>
    );
  }

  // Locale-aware date format. Map nos locales i18n vers BCP47.
  const dateLocale = locale === "he" ? "he-IL" : locale === "en" ? "en-US" : "fr-FR";
  const lastUpdated = new Date(config.updatedAt).toLocaleString(dateLocale, {
    dateStyle: "long",
    timeStyle: "short",
  });

  // Stats hero — agrégat depuis la table `calls`. Pas de durée stockée
  // côté DB, on estime via `transcript.length × 6s/bulle`. Pas de outcome
  // structuré : "RDV pris" via heuristique keyword dans `summary`. Conversion
  // = pourcentage d'appels avec summary non-vide (proxy "appel utile").
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  );
  const stats = await (async () => {
    const userIdRef = session.user!.id!;
    const [todayRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(calls)
      .where(
        and(eq(calls.userId, userIdRef), gte(calls.createdAt, startOfToday)),
      );
    const [monthRow] = await db
      .select({
        // Total estimé en secondes pour les calls du mois (×6s par bulle).
        totalSeconds: sql<number>`coalesce(sum(jsonb_array_length(transcript)) * 6, 0)::int`,
      })
      .from(calls)
      .where(
        and(eq(calls.userId, userIdRef), gte(calls.createdAt, startOfMonth)),
      );
    const [totalRow] = await db
      .select({
        count: sql<number>`count(*)::int`,
        withSummary: sql<number>`count(*) filter (where length(summary) > 0)::int`,
        rdv: sql<number>`count(*) filter (where summary ~* 'rdv|rendez-vous|appointment|תור')::int`,
        avgBubbles: sql<number>`coalesce(avg(jsonb_array_length(transcript)), 0)::float`,
      })
      .from(calls)
      .where(eq(calls.userId, userIdRef));
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
    // Minutes totales appelées sur le numéro depuis le 1er du mois.
    const monthSeconds = monthRow?.totalSeconds ?? 0;
    const monthMinutes = Math.round(monthSeconds / 60);
    return {
      callsToday: todayRow?.count ?? 0,
      conversion,
      avgDuration,
      rdv: totalRow?.rdv ?? 0,
      minutesThisMonth: monthMinutes,
    };
  })();

  // Construit la preview des blocs admin hérités (pour le popup de la
  // checkbox). On lit les directives system per-plan + admin block et
  // on assemble dans l'ordre per-plan, puis on filtre pour ne garder que
  // les blocs admin-managed (exclut persona + language).
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

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 sm:px-6 sm:pt-8">
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
          // Champ `business` ajouté en parallèle par la migration schema
          // (jsonb). Tant que la colonne n'est pas en place, on retombe sur
          // DEFAULT_BUSINESS. `config` est typé Drizzle donc on lit le
          // champ via cast unknown pour rester safe vis-à-vis du JIT type.
          business: (() => {
            const maybe = (config as unknown as { business?: unknown })
              .business;
            if (
              maybe &&
              typeof maybe === "object" &&
              Array.isArray((maybe as { centres?: unknown }).centres)
            ) {
              return maybe as typeof DEFAULT_BUSINESS;
            }
            return DEFAULT_BUSINESS;
          })(),
        }}
        isAdmin={isAdmin}
        features={features}
        adminInheritablePreview={adminInheritablePreview}
        planLabel={planLabel}
        primaryPhone={primaryPhone?.phoneNumber ?? null}
        lastUpdatedLabel={lastUpdated}
        stats={stats}
      />
    </main>
  );
}
