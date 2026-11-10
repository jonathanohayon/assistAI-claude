// The /api/agent/config handler, MOVED VERBATIM from its route file (A3) so the
// legacy route and the single session-config route run the SAME code: the
// legacy response stays byte-identical. SERVER-ONLY.

import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema";
import { getAgentBrain, toWorkerWebhook } from "@/lib/agent-brain";
import { logEvent } from "@/lib/logger";
import { reportTenantFallback } from "@/lib/tenant-fallback";
import { resolveInboundTenantWith } from "@/lib/tenant-resolution";
import { servedInboundVoice } from "@/lib/voice/serve";
import { inboundSessionInstructions } from "@/lib/agent/session-instructions";
import { toEngineSettings } from "@/lib/voice/engine";
import { TRIAL_PAUSED_STATUS, isTrialExhausted } from "@/lib/trial";
import { getClientProfile } from "@/lib/loyalty-profile";
import { effectiveGreeting } from "@/lib/ai-disclosure";
import { markForwardingTestCall } from "@/lib/forwarding-test-db";
import { getTileToggles } from "@/lib/tile-toggles";
import { receptionistCallFields, toolsFromTileToggles } from "@/lib/tools/adapters";
import { effectiveCapabilities } from "@/lib/tools/contract";
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
export async function handleInboundConfig(req: NextRequest): Promise<Response> {
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
  // Every default-tenant fallback is reported (tenant_fallback_used + alert).
  const lookup = await resolveInboundTenantWith(
    { origin: "agent_config", phone, userId },
    {
      byUserId: resolveTenantByUserId,
      byPhone: resolveTenantByPhone,
      byDefault: resolveDefaultTenant,
      accountId: (t) => t.user.id,
      onFallback: reportTenantFallback,
    },
  );
  const { resolution, tenant } = lookup;
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
  // perCallContextTemplate follows the same inheritAdminGlobals rule as the
  // admin blocks of the instructions (see lib/agent/session-instructions.ts).
  const inherits = config.inheritAdminGlobals !== false;
  const perCallContextTemplate = inherits
    ? perCallContextByPlan[planKey] ?? ""
    : "";
  // Features activées pour le plan de ce tenant (matrice admin). Le worker
  // utilise cette map pour décider quels tools enregistrer (cf. recent
  // session : règles métier déterministes côté tools, pas dans le prompt).
  const planFeatures = featuresForPlan(planMatrix, tenant.user.subscriptionPlan);

  // Toggles par tuile CRM (pilotés par le tenant) : ne peuvent que DÉSACTIVER
  // une feature autorisée par le plan. Le worker n'enregistre alors plus les
  // tools correspondants, et le prompt annonce la capacité comme désactivée.
  const tileToggles = await getTileToggles(tenant.user.id);
  // Tools brick (T1): ONE function decides what the call gets — the same the
  // screen will show. Orders (record_order) ride on the CRM plan feature and
  // the "Commandes" toggle; transfer on the number (served below).
  const capabilities = effectiveCapabilities(
    { recipe: "receptionist", tools: toolsFromTileToggles(tileToggles) },
    { transferNumber: tenant.config.transferNumber ?? "", googleConnected: Boolean(tenant.user.googleRefreshToken) },
    planFeatures,
  );
  const { features, ordersEnabled } = receptionistCallFields(capabilities, planFeatures);

  // Template "capacités" éditable par plan depuis /admin.
  const capabilitiesByPlan = await getCapabilitiesDirectiveByPlan();

  // The session instructions: ONE pure function (also used by the prompt
  // preview). Block order, admin blocks (blanked when inheritAdminGlobals is
  // false), knowledge, language, capabilities.
  const mergedInstructions = inboundSessionInstructions({
    config,
    planKey,
    directives: {
      globalByPlan,
      spokenTimeByPlan,
      spokenPhoneByPlan,
      hangupByPlan,
      configBlocksByPlan,
      blockOrderByPlan,
      capabilitiesByPlan,
    },
    capabilities: { calendar: features.calendar, crm: features.crm, orders: ordersEnabled },
  });

  // Strip internal IDs — the agent only needs the runtime values.
  // personaConfig (P3) stays out of the worker payload: calls still read the
  // legacy persona columns until the reader switch.
  const { id: _id, userId: _userId, updatedAt, personaConfig: _personaConfig, ...runtime } = config;
  void _personaConfig;
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
  // Forwarding setup check: an inbound PHONE call (?phone=, not the web
  // LiveTest) during the tenant's test window verifies forwarding.
  // Fire-and-forget, never delays the config.
  if (phone && !userId) {
    void markForwardingTestCall(tenant.user.id, {
      forwardedFrom: req.nextUrl.searchParams.get("forwardedFrom"),
      via: "call_start",
    });
  }
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

  const voiceConfig = servedInboundVoice(tenant.config, tenant.config.model || "gpt-realtime-2");
  const engine = toEngineSettings(voiceConfig, { defaultModel: tenant.config.model || "gpt-realtime-2" });

  return NextResponse.json({
    ...runtime,
    ...(agentWebhook ? { agentWebhook } : {}),
    instructions: mergedInstructions,
    // Engine (admin-only setting, "openai" when unset) and the full voice
    // profile (defaults = today) now come from `...engine` below.
    // Voice contract (V2), served as `voiceConfig` (`voice` is the legacy
    // voice id the live worker reads), plus the legacy engine fields built
    // THROUGH it — identical to the columns (proven by the route snapshots).
    voiceConfig,
    ...engine,
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
