import { eq } from "drizzle-orm";
import type { VoiceProfile } from "@/lib/voice-profile";
import { effectiveRealtimeProvider } from "@/lib/realtime-provider";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import {
  DEFAULT_CAPABILITIES_DIRECTIVE,
  DEFAULT_PROMPT_BLOCK_ORDER,
} from "@/lib/agent-prompt-defaults";
import { buildAgentPromptPreview } from "@/lib/agent-prompt-preview";
import { renderCapabilitiesDirective } from "@/lib/capabilities";
import { computeDashboardStats } from "@/lib/dashboard-stats";
import { db } from "@/lib/db";
import { agentConfigs, phoneNumbers, users } from "@/lib/db/schema";
import { featuresForPlan } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import { PLANS, type PlanKey } from "@/lib/plans";
import {
  getCapabilitiesDirectiveByPlan,
  getConfigBlocksDirectiveByPlan,
  getGlobalInstructionsByPlan,
  getHangupDirectiveByPlan,
  getPerCallContextTemplateByPlan,
  getPromptBlockOrderByPlan,
  getSpokenPhoneDirectiveByPlan,
  getSpokenTimeDirectiveByPlan,
} from "@/lib/settings";
import { getTileToggles } from "@/lib/tile-toggles";

import { SetupChecklist } from "@/components/dashboard/SetupChecklist";

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
    .select({
      role: users.role,
      subscriptionPlan: users.subscriptionPlan,
      googleRefreshToken: users.googleRefreshToken,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  const isAdmin = me?.role === "admin";
  const planKey: PlanKey =
    me?.subscriptionPlan && PLANS.some((p) => p.key === me.subscriptionPlan)
      ? (me.subscriptionPlan as PlanKey)
      : PLANS[0].key;
  const tPlans = await getTranslations({ locale, namespace: "Plans" });
  const planLabel = tPlans.has(`${planKey}.name`)
    ? tPlans(`${planKey}.name`)
    : (PLANS.find((p) => p.key === planKey)?.name ?? planKey);

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

  // Stats hero — see lib/dashboard-stats.ts (real durations and bookings).
  const stats = await computeDashboardStats(session.user!.id!);

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
  // Bloc capacités rendu (placeholders substitués selon les toggles du tenant)
  // — affiché en fin d'aperçu, identique à ce qu'envoie /api/agent/config.
  const tileToggles = await getTileToggles(session.user.id);
  const capabilitiesTemplate =
    (await getCapabilitiesDirectiveByPlan())[planKey] ??
    DEFAULT_CAPABILITIES_DIRECTIVE;
  const capabilitiesRendered = renderCapabilitiesDirective(capabilitiesTemplate, {
    calendar: Boolean(features.calendar) && tileToggles.calendar,
    crm: Boolean(features.crm) && tileToggles.customers,
    orders: Boolean(features.crm) && tileToggles.orders,
  });
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
    capabilities: capabilitiesRendered,
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

  // État réel du tenant → checklist de setup en haut du dashboard.
  const hasPhone = Boolean(primaryPhone);
  const googleConnected = Boolean(me?.googleRefreshToken);
  // "Scanner mon site" terminé = l'agent a des infos métier. On ne se limite
  // pas au nom (le scan peut remplir services/centres/base de connaissances
  // sans extraire un nom net) : n'importe quelle donnée métier renseignée coche
  // l'étape.
  const biz = (
    config as unknown as {
      business?: {
        identity?: { name?: string };
        services?: unknown[];
        centres?: unknown[];
        knowledgeBase?: string;
      };
    }
  ).business;
  const businessFilled = Boolean(
    biz?.identity?.name?.trim().length ||
      (biz?.services?.length ?? 0) > 0 ||
      (biz?.centres?.length ?? 0) > 0 ||
      biz?.knowledgeBase?.trim().length,
  );
  const whatsappSet = Boolean(config?.ownerWhatsapp?.trim().length);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 sm:px-6 sm:pt-8">
      {/* Checklist de setup. Tant que tout n'est pas configuré → liste d'étapes.
          Une fois complet → carte "Félicitations + tips" (masquable). Le
          composant gère lui-même le rendu null quand masquée. */}
      <SetupChecklist
        hasPhone={hasPhone}
        googleConnected={googleConnected}
        businessFilled={businessFilled}
        whatsappSet={whatsappSet}
      />
      <ConfigForm
        initial={{
          instructions: config.instructions,
          greetingInstructions: config.greetingInstructions,
          model: config.model,
          // Admin-only field, never part of a tenant form state.
          ...(isAdmin
            ? {
                realtimeProvider: effectiveRealtimeProvider(config.realtimeProvider),
                // Stored JSONB, validated by voiceProfileSchema on write.
          voiceProfile: (config.voiceProfile ?? null) as Partial<VoiceProfile> | null,
              }
            : {}),
          voice: config.voice,
          temperature: config.temperature,
          speed: config.speed,
          maxResponseTokens: config.maxResponseTokens,
          ownerWhatsapp: config.ownerWhatsapp,
          primaryLanguage: config.primaryLanguage ?? "fr",
          reminderEnabled: config.reminderEnabled ?? false,
          inheritAdminGlobals: config.inheritAdminGlobals ?? true,
          personality: config.personality ?? {},
          agentName: config.agentName ?? "",
          aiDisclosureEnabled: config.aiDisclosureEnabled ?? true,
          aiDisclosureText: config.aiDisclosureText ?? "",
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
