import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { DEFAULT_PROMPT_BLOCK_ORDER } from "@/lib/agent-prompt-defaults";
import { buildAgentPromptPreview } from "@/lib/agent-prompt-preview";
import { db } from "@/lib/db";
import { agentConfigs, phoneNumbers, users } from "@/lib/db/schema";
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

import { ConfigForm } from "./config-form";

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
      <main className="mx-auto w-full max-w-5xl px-6 py-12">
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
    <main>
      {primaryPhone?.phoneNumber && (
        <section className="mx-auto w-full max-w-5xl px-6 pt-8">
          <p className="font-mono text-xl font-semibold tracking-tight text-pink-600 sm:text-2xl">
            {primaryPhone.phoneNumber}
          </p>
        </section>
      )}

      <section className="mx-auto w-full max-w-5xl px-6 pt-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
          {t("header")}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
          {t("pageTitle")}
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
          {t("pageSubtitle")}
        </p>
        <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">
          {t("lastUpdated")}{" "}
          {new Date(config.updatedAt).toLocaleString(dateLocale, {
            dateStyle: "long",
            timeStyle: "short",
          })}
        </p>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-8 pb-20">
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
          }}
          isAdmin={isAdmin}
          adminInheritablePreview={adminInheritablePreview}
          planLabel={planLabel}
        />
      </section>
    </main>
  );
}
