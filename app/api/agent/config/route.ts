import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { DEFAULT_CAPABILITIES_DIRECTIVE } from "@/lib/agent-prompt-defaults";
import { renderCapabilitiesDirective } from "@/lib/capabilities";
import { isTrialExhausted } from "@/lib/trial";
import { getTileToggles } from "@/lib/tile-toggles";
import { featuresForPlan } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import { PLANS, type PlanKey } from "@/lib/plans";
import {
  getCapabilitiesDirectiveByPlan,
  getConfigBlocksDirectiveByPlan,
  getGlobalInstructionsByPlan,
  getGreetingFallbackTemplateByPlan,
  getHangupDirectiveByPlan,
  getPerCallContextTemplateByPlan,
  getPromptBlockOrderByPlan,
  getSpokenPhoneDirectiveByPlan,
  getSpokenTimeDirectiveByPlan,
} from "@/lib/settings";
import {
  resolveDefaultTenant,
  resolveTenantByPhone,
  resolveTenantByUserId,
} from "@/lib/tenant";

// Read-only endpoint consumed by the LiveKit agent worker at session start.
// Routes by `?phone=<called number>` to load the right tenant's config.
//
// Effective instructions = [global system prompt set by admin] + [tenant persona]
// — that way every tenant inherits cross-cutting rules (anti-silence, tool
// description, response length, etc.) without each having to re-paste them.
export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone");
  // Phase 2 (web LiveTest via LiveKit) : le worker passe `userId` extrait
  // du `participant.metadata` JSON pour cibler directement le bon tenant
  // sans chercher un phone_number row. Prioritaire sur `phone` si présent.
  const userId = req.nextUrl.searchParams.get("userId");
  // Inline resolution so we can log WHICH path was taken — silent fallback
  // to default tenant has burned us before (calendar tools used the wrong
  // user's Google credentials → "Google not connected" symptom).
  let tenant = userId
    ? await resolveTenantByUserId(userId)
    : phone
      ? await resolveTenantByPhone(phone)
      : null;
  const resolution:
    | "user_match"
    | "phone_match"
    | "default_fallback"
    | "no_id" = tenant
    ? userId
      ? "user_match"
      : "phone_match"
    : phone || userId
      ? "default_fallback"
      : "no_id";
  if (!tenant) tenant = await resolveDefaultTenant();
  if (!tenant) {
    return NextResponse.json({ error: "No tenant" }, { status: 404 });
  }

  // ── Plafond essai gratuit : 60 min d'appels OU 24h, au premier atteint ──
  // Pour un tenant `trialing`, on refuse de servir la config (403) dès qu'une
  // des deux limites est franchie → le worker ne démarre pas l'agent. La
  // suppression complète (compte + numéro Twilio) à 24h reste gérée par le
  // cron trial-cleanup ; ce gate coupe en amont quand les 60 min sont
  // atteintes avant la fin des 24h.
  if (tenant.user.subscriptionStatus === "trialing") {
    const [usage] = await db
      .select({
        seconds: sql<number>`coalesce(sum(${calls.durationSeconds}), 0)::int`,
      })
      .from(calls)
      .where(eq(calls.userId, tenant.user.id));
    const trialSecondsUsed = usage?.seconds ?? 0;
    if (
      isTrialExhausted({
        subscriptionStatus: tenant.user.subscriptionStatus,
        trialEndsAt: tenant.user.trialEndsAt,
        trialSecondsUsed,
      })
    ) {
      await logEvent({
        source: "tenant",
        event: "trial_exhausted_block",
        message: `Appel refusé : essai épuisé (${Math.round(
          trialSecondsUsed / 60,
        )} min utilisées) pour ${tenant.user.email}`,
        level: "warn",
        userId: tenant.user.id,
        metadata: {
          trialSecondsUsed,
          trialEndsAt: tenant.user.trialEndsAt,
        },
      });
      return NextResponse.json({ error: "trial_exhausted" }, { status: 403 });
    }
  }

  // ── Parallel DB roundtrips ─────────────────────────────────────────────
  // Toutes les lectures suivantes sont indépendantes. Promise.all les
  // groupe en parallèle → on économise ~6x le coût round-trip vs sériel.
  // logEvent reste awaited pour ne pas perdre l'insert si Railway tue
  // la fonction avant le flush.
  const [
    ,
    globalByPlan,
    planMatrix,
    spokenTimeByPlan,
    spokenPhoneByPlan,
    hangupByPlan,
    perCallContextByPlan,
    configBlocksByPlan,
    blockOrderByPlan,
    greetingFallbackByPlan,
  ] = await Promise.all([
    logEvent({
      source: "tenant",
      event: "agent_config_loaded",
      message: `Config chargée pour ${tenant.user.email} via ${resolution} (called=${phone ?? "(none)"}, userId=${userId ?? "(none)"}, googleConnected=${Boolean(tenant.user.googleRefreshToken)})`,
      level:
        resolution === "phone_match" || resolution === "user_match"
          ? "info"
          : "warn",
      userId: tenant.user.id,
      metadata: {
        resolution,
        calledPhone: phone,
        requestUserId: userId,
        hasGoogle: Boolean(tenant.user.googleRefreshToken),
        hasCalendarId: Boolean(tenant.user.googleCalendarId),
      },
    }),
    getGlobalInstructionsByPlan(),
    getPlanFeatureMatrix(),
    getSpokenTimeDirectiveByPlan(),
    getSpokenPhoneDirectiveByPlan(),
    getHangupDirectiveByPlan(),
    getPerCallContextTemplateByPlan(),
    getConfigBlocksDirectiveByPlan(),
    getPromptBlockOrderByPlan(),
    getGreetingFallbackTemplateByPlan(),
  ]);

  const { config } = tenant;
  // Préfixe global per-plan : permet d'avoir des règles transverses
  // différentes selon Basique / Globale / Premium (ex. ton commercial
  // différent, mentions légales spécifiques). Fallback sur le préfixe du
  // plan whatsapp/Basique si plan inconnu (ex. legacy admin "essential").
  const planKey: PlanKey =
    tenant.user.subscriptionPlan &&
    PLANS.some((p) => p.key === tenant.user.subscriptionPlan)
      ? (tenant.user.subscriptionPlan as PlanKey)
      : PLANS[0].key;
  // Toutes les directives sont per-plan : on extrait la version du plan
  // du tenant. Si le tenant a `inheritAdminGlobals=false`, on remplace par
  // "" pour ne PAS injecter les blocs admin → le prompt assemblé contient
  // alors uniquement persona + language directive.
  const inherits = config.inheritAdminGlobals !== false;
  const spokenTime = inherits ? spokenTimeByPlan[planKey] ?? "" : "";
  const spokenPhone = inherits ? spokenPhoneByPlan[planKey] ?? "" : "";
  const hangup = inherits ? hangupByPlan[planKey] ?? "" : "";
  const perCallContextTemplate = inherits
    ? perCallContextByPlan[planKey] ?? ""
    : "";
  const configBlocks = inherits ? configBlocksByPlan[planKey] ?? "" : "";
  const blockOrder = blockOrderByPlan[planKey] ?? [];
  const globalInstructions = inherits ? globalByPlan[planKey] ?? "" : "";
  // Features activées pour le plan de ce tenant (matrice admin). Le worker
  // utilise cette map pour décider quels tools enregistrer (cf. recent
  // session : règles métier déterministes côté tools, pas dans le prompt).
  const planFeatures = featuresForPlan(planMatrix, tenant.user.subscriptionPlan);

  // Toggles par tuile CRM (pilotés par le tenant) : ne peuvent que DÉSACTIVER
  // une feature autorisée par le plan. Le worker n'enregistre alors plus les
  // tools correspondants, et le prompt annonce la capacité comme désactivée.
  const tileToggles = await getTileToggles(tenant.user.id);
  const features = {
    ...planFeatures,
    calendar: planFeatures.calendar && tileToggles.calendar,
    crm: planFeatures.crm && tileToggles.customers,
  };
  // Prise de commandes au téléphone (nouveau tool record_order côté worker) :
  // réservée aux plans CRM, activable via le toggle "Commandes".
  const ordersEnabled = Boolean(planFeatures.crm) && tileToggles.orders;

  // Template "capacités" éditable par plan depuis /admin ({calendar}/{crm}/
  // {orders} substitués par le statut réel du tenant). Toujours présent.
  const capabilitiesByPlan = await getCapabilitiesDirectiveByPlan();
  const capabilitiesDirective = renderCapabilitiesDirective(
    capabilitiesByPlan[planKey] ?? DEFAULT_CAPABILITIES_DIRECTIVE,
    { calendar: features.calendar, crm: features.crm, orders: ordersEnabled },
  );

  const langLabel: Record<string, string> = {
    fr: "français",
    he: "hébreu",
    en: "anglais (US)",
  };
  const primary = config.primaryLanguage ?? "fr";
  const languageDirective = `LANGUE PAR DÉFAUT DU TENANT : ${langLabel[primary] ?? "français"} (code: ${primary}).
- Utilise cette langue UNIQUEMENT pour le tout premier message d'accueil.
- Dès que ton interlocuteur parle, détecte sa langue et réponds STRICTEMENT dans la sienne.
- S'il/elle bascule à une autre langue, suis-le/la immédiatement.`;

  // L'ordre des blocs est piloté depuis /admin (app_settings.prompt_block_order).
  // Default order = directives système d'abord, puis config_blocks (meta
  // "respecte les étapes"), puis persona, langue, admin global. L'admin
  // peut tout réordonner — y compris déplacer la persona avant les
  // directives, ou bouger admin_global en tête, etc.
  const adminBlock = globalInstructions
    ? `RÈGLES TRANSVERSES ADDITIONNELLES (à appliquer EN COMPLÉMENT du persona, jamais à sa place) :\n\n${globalInstructions}`
    : "";

  // Bloc business tenant — formatte la structure { identity, centres,
  // services } en section référence pour le prompt. Fallback sur le
  // legacy `knowledge` array si business pas encore peuplé pour ce tenant.
  let businessBlock = "";
  if (
    config.business &&
    typeof config.business === "object" &&
    ((config.business.identity?.name ?? "").length > 0 ||
      (config.business.centres?.length ?? 0) > 0 ||
      (config.business.services?.length ?? 0) > 0)
  ) {
    const { renderBusinessPromptBlock, sanitizeBusinessConfig } = await import(
      "@/lib/business"
    );
    businessBlock = renderBusinessPromptBlock(
      sanitizeBusinessConfig(config.business),
    );
  } else if (Array.isArray(config.knowledge) && config.knowledge.length > 0) {
    // Fallback legacy : un tenant qui a juste l'ancien knowledge mais pas
    // encore migré vers business. Affiche en bloc texte simple.
    const knowledgeEntries = config.knowledge.filter(
      (e) => (e?.businessName?.length ?? 0) > 0 || (e?.description?.length ?? 0) > 0,
    );
    if (knowledgeEntries.length > 0) {
      businessBlock = `BUSINESS — INFOS LEGACY (sera migré vers structure complète au prochain save dashboard) :\n\n${knowledgeEntries
        .map((e, i) => {
          const lines: string[] = [];
          lines.push(`### ${i + 1}. ${e.businessName || "(sans nom)"}`);
          if (e.openingHours) lines.push(`Horaires : ${e.openingHours}`);
          if (e.description) lines.push(`Détails : ${e.description}`);
          return lines.join("\n");
        })
        .join("\n\n")}`;
    }
  }

  const blockContent: Record<string, string> = {
    spoken_time: spokenTime,
    spoken_phone: spokenPhone,
    hangup,
    config_blocks: configBlocks,
    persona: config.instructions,
    knowledge: businessBlock,
    language: languageDirective,
    admin_global: adminBlock,
  };
  const SEP = "\n\n──────────────────────────────────────────\n\n";
  const mergedInstructions = [
    ...blockOrder.map((id) => blockContent[id] ?? "").filter(Boolean),
    capabilitiesDirective,
  ].join(SEP);

  // Strip internal IDs — the agent only needs the runtime values.
  const { id: _id, userId: _userId, updatedAt, ...runtime } = config;
  void _id;
  void _userId;
  // Greeting fallback per-plan : utilisé par le worker quand
  // agent_configs.greeting_instructions est vide. Placeholder
  // `{agent_name}` substitué côté worker (cf. agent.ts).
  const greetingFallbackTemplate = greetingFallbackByPlan[planKey] ?? "";

  return NextResponse.json({
    ...runtime,
    instructions: mergedInstructions,
    features,
    ordersEnabled,
    updatedAt,
    // Template per-call avec placeholders {date_fr}, {iso_date}, {time},
    // {caller_hint_block} substitués côté worker à chaque appel.
    perCallContextTemplate,
    greetingFallbackTemplate,
  });
}
