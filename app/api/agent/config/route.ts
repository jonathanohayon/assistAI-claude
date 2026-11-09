import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema";
import { getAgentBrain, toWorkerWebhook } from "@/lib/agent-brain";
import { logEvent } from "@/lib/logger";
import { decideTenantResolution } from "@/lib/tenant-resolution";
import { DEFAULT_CAPABILITIES_DIRECTIVE } from "@/lib/agent-prompt-defaults";
import { effectiveRealtimeProvider } from "@/lib/realtime-provider";
import { effectiveVoiceProfile } from "@/lib/voice-profile";
import { renderCapabilitiesDirective } from "@/lib/capabilities";
import { TRIAL_PAUSED_STATUS, isTrialExhausted } from "@/lib/trial";
import { getClientProfile } from "@/lib/loyalty-profile";
import { effectiveGreeting } from "@/lib/ai-disclosure";
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

// Read-only endpoint consumed by the LiveKit agent worker at session start,
// gated by INTERNAL_SECRET.
// Routes by `?phone=<called number>` to load the right tenant's config.
//
// Effective instructions = [global system prompt set by admin] + [tenant persona]
// — that way every tenant inherits cross-cutting rules (anti-silence, tool
// description, response length, etc.) without each having to re-paste them.
export async function GET(req: NextRequest) {
  // Worker-only, like every other /api/agent/* route: the response carries a
  // tenant's full prompt, business data and external-brain webhook secret.
  // The worker sends x-internal-secret on every call (src/web-api.ts).
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;

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
  const resolution = decideTenantResolution({
    phone,
    userId,
    matched: Boolean(tenant),
  });
  if (resolution === "unknown_number") {
    // Refuse rather than serve another tenant. The worker hangs up on 404.
    await logEvent({
      source: "tenant",
      event: "unknown_dialed_number",
      message: `Appel refusé : aucun tenant pour le numéro ${phone}`,
      level: "error",
      metadata: { toNumber: phone },
    });
    return NextResponse.json({ error: "unknown_number" }, { status: 404 });
  }
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
  // Admins are exempt: the prod admin is `trialing` with no end date, and the
  // 60-min cap would cut their own number once call durations are recorded.
  // Trialing OR paused (trial ended, not paid): a paused account must be
  // refused too, so it can't skip this block on its status.
  if (
    (tenant.user.subscriptionStatus === "trialing" ||
      tenant.user.subscriptionStatus === TRIAL_PAUSED_STATUS) &&
    tenant.user.role !== "admin"
  ) {
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
        role: tenant.user.role,
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

  // ── Cerveau de l'agent : persona Tamara, ou agent externe du tenant ──
  // Réglage par tenant (dashboard). Quand il est actif, le worker cesse
  // d'utiliser la persona assemblée ci-dessus : il transcrit, POSTe chaque
  // tour au endpoint du tenant, et prononce la réponse.
  //
  // AGENT_WEBHOOK_URL reste accepté comme surcharge globale, utile pour
  // tester un endpoint sur tous les tenants sans toucher à leurs réglages.
  // Loyalty v1: who is calling (worker passes `caller`, the From number).
  // Capped at 300 ms and null-safe: never delays or breaks the config.
  const clientProfilePromise = getClientProfile(
    tenant.user.id,
    req.nextUrl.searchParams.get("caller"),
  );
  const brain = await getAgentBrain(tenant.user.id);
  const envOverride = process.env.AGENT_WEBHOOK_URL;
  const agentWebhook =
    envOverride && envOverride.startsWith("http")
      ? {
          url: envOverride,
          ...(process.env.AGENT_WEBHOOK_SECRET
            ? { secret: process.env.AGENT_WEBHOOK_SECRET }
            : {}),
        }
      : toWorkerWebhook(brain);
  if (agentWebhook) {
    await logEvent({
      source: "tenant",
      event: "agent_brain_external",
      message: `Cerveau externe actif pour ${tenant.user.email} → ${agentWebhook.url}${envOverride ? " (AGENT_WEBHOOK_URL global override: every tenant goes there)" : ""}`,
      // The env override reroutes EVERY tenant to one endpoint with one
      // secret. Fine for a test, an incident if left on in prod: make it loud.
      level: envOverride ? "warn" : "info",
      userId: tenant.user.id,
      metadata: { via: envOverride ? "env_override" : "tenant_setting" },
    });
  }

  return NextResponse.json({
    ...runtime,
    ...(agentWebhook ? { agentWebhook } : {}),
    instructions: mergedInstructions,
    // Speech-to-speech engine (admin-only setting). "openai" when unset.
    realtimeProvider: effectiveRealtimeProvider(tenant.config.realtimeProvider),
    // Voice profile (admin-only setting), always complete: defaults = today.
    voiceProfile: effectiveVoiceProfile(tenant.config.voiceProfile),
    // Call transfer target ('' = none): the worker registers transfer_call only if set.
    transferNumber: tenant.config.transferNumber ?? "",
    // Greeting the worker speaks verbatim, AI disclosure included — the SAME
    // text as the pre-rendered opener (lib/ai-disclosure.ts effectiveGreeting).
    greetingInstructions: effectiveGreeting(tenant.config, tenant.user.displayName ?? ""),
    // Caller's visit history with this tenant (null = unknown / first call).
    clientProfile: await clientProfilePromise,
    features,
    ordersEnabled,
    updatedAt,
    // Template per-call avec placeholders {date_fr}, {iso_date}, {time},
    // {caller_hint_block} substitués côté worker à chaque appel.
    perCallContextTemplate,
    greetingFallbackTemplate,
  });
}
