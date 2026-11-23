// The /api/agent/config handler, MOVED VERBATIM from its route file (A3) so the
// legacy route and the single session-config route run the SAME code: the
// legacy response stays byte-identical. SERVER-ONLY.

import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { getAgentBrain, toWorkerWebhook } from "@/lib/agent-brain";
import { servedAgentWebhook } from "@/lib/agent-brain-guard";
import { alertAdmins } from "@/lib/alerts";
import { alertLegacyBrainOverlapSafely } from "@/lib/agent/legacy-brain-overlap";
import { logEvent } from "@/lib/logger";
import { reportTenantFallback } from "@/lib/tenant-fallback";
import { resolveInboundTenantWith } from "@/lib/tenant-resolution";
import { servedInboundVoice } from "@/lib/voice/serve";
import { workerRuntimeConfig } from "@/lib/agent/worker-runtime-config";
import { inboundSessionInstructions } from "@/lib/agent/session-instructions";
import { toEngineSettings } from "@/lib/voice/engine";
import { decideEngineSafely, decideInboundEngine, inboundToday, type DecideDeps } from "@/lib/engine-override-load";
import { voiceOnEngine } from "@/lib/voice/override-voice";
import { getClientProfile } from "@/lib/loyalty-profile";
import { effectiveGreeting } from "@/lib/ai-disclosure";
import { markForwardingTestCall } from "@/lib/forwarding-test-db";
import { getTileToggles } from "@/lib/tile-toggles";
import { clientAgentCallField, receptionistCallFields } from "@/lib/tools/adapters";
import { openClientAgentTools } from "@/lib/tools/client-agent-secret";
import { clientAgentEnabled, clientAgentMode } from "@/lib/tools/client-agent-switch";
import { checkAgentUrl, type CheckOptions, type Resolver } from "@/lib/net/safe-url";
import { reportUnreadableSecret, type UnreadableReporter } from "@/lib/crypto/unreadable-secret";
import type { OnFallback } from "@/lib/tenant-resolution";
import { inboundTrialRefusal } from "@/lib/agent/session-config/trial-gate";
import { receptionistCapabilities } from "@/lib/tools/store";
import { featuresForPlan } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import { PLANS, type PlanKey } from "@/lib/plans";
import { fireSafely } from "@/lib/agent/fire-safely";
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

/** DNS budget of the serve-time webhook check (call setup path). */
const SERVE_DNS_TIMEOUT_MS = 500;
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
  return buildInboundConfig(req.nextUrl.searchParams, LIVE_INBOUND_EFFECTS);
}

/**
 * Every side effect and network step of the inbound resolver, injected so the
 * dashboard's agentState (lib/agent-state/compute.ts) can run the SAME
 * resolver as a dry run: no event, no alert, no forwarding mark, no DNS.
 */
export interface InboundEffects {
  logEvent: typeof logEvent;
  /** The engine decision's reads (tests inject failures); unset = the real ones. */
  engineDeps?: DecideDeps;
  alertAdmins: (args: Parameters<typeof alertAdmins>[0]) => Promise<unknown>;
  onFallback: OnFallback;
  markForwardingTestCall: typeof markForwardingTestCall;
  getClientProfile: typeof getClientProfile;
  /** Reporter for a sealed secret that can't be opened (E1). */
  reportUnreadable: UnreadableReporter;
  /** Options of the serve-time url checks (DNS budget, or an injected resolver). */
  urlCheck: CheckOptions;
}

/** The real effects: what the worker's call gets. */
export const LIVE_INBOUND_EFFECTS: InboundEffects = {
  logEvent,
  alertAdmins: (args) => alertAdmins(args),
  onFallback: reportTenantFallback,
  markForwardingTestCall,
  getClientProfile,
  reportUnreadable: reportUnreadableSecret,
  urlCheck: { dnsTimeoutMs: SERVE_DNS_TIMEOUT_MS },
};

/** Dry run: no lookup at all; the url checks see a DNS failure (the safe outcome). */
const noDnsResolver: Resolver = async () => {
  throw new Error("dry run: no DNS");
};

/**
 * Dry-run effects: nothing is written, alerted or looked up. A refused
 * webhook / client agent never changes the status (the call still gets the
 * normal Tamara), so skipping DNS can't change whether the config builds.
 */
export const DRY_INBOUND_EFFECTS: InboundEffects = {
  logEvent: async () => {},
  alertAdmins: async () => false,
  onFallback: () => {},
  markForwardingTestCall: async () => false,
  getClientProfile: async () => null,
  reportUnreadable: () => {},
  urlCheck: { resolver: noDnsResolver },
};

/**
 * The inbound session config for these query params (phone / userId /
 * caller / forwardedFrom), the caller already authenticated.
 */
export async function buildInboundConfig(params: URLSearchParams, fx: InboundEffects): Promise<Response> {
  const phone = params.get("phone");
  // Phase 2 (web LiveTest via LiveKit) : le worker passe `userId` extrait
  // du `participant.metadata` JSON pour cibler directement le bon tenant
  // sans chercher un phone_number row. Prioritaire sur `phone` si présent.
  const userId = params.get("userId");
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
      onFallback: fx.onFallback,
    },
  );
  const { resolution, tenant } = lookup;
  if (resolution === "unknown_number") {
    // Refuse rather than serve another tenant. The worker hangs up on 404.
    await fx.logEvent({
      source: "tenant",
      event: "unknown_dialed_number",
      message: "Appel refusé : aucun tenant pour le numéro appelé",
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
  // The decision lives in lib/agent/session-config/trial-gate.ts, shared with
  // the dashboard's agentState (lib/agent-state/compute.ts).
  {
    const refusal = await inboundTrialRefusal(tenant.user);
    if (refusal) {
      const { trialSecondsUsed } = refusal;
      await fx.logEvent({
        source: "tenant",
        event: "trial_exhausted_block",
        message: `Appel refusé : essai épuisé (${Math.round(
          trialSecondsUsed / 60,
        )} min utilisées) pour ${tenant.user.id}`,
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
    fx.logEvent({
      source: "tenant",
      event: "agent_config_loaded",
      message: `Config chargée pour ${tenant.user.id} via ${resolution} (userId=${userId ?? "(none)"}, googleConnected=${Boolean(tenant.user.googleRefreshToken)})`,
      level:
        resolution === "phone_match" || resolution === "user_match"
          ? "info"
          : "warn",
      userId: tenant.user.id,
      metadata: {
        resolution,
        // The tenant's own dialled line (kept in clear, lib/event-pii.ts).
        toNumber: phone,
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
  const { capabilities, tools } = receptionistCapabilities(
    tenant.config,
    tileToggles,
    Boolean(tenant.user.googleRefreshToken),
    planFeatures,
    // T5: the CLIENT_AGENT switch for this account (off = nothing changes).
    clientAgentEnabled(clientAgentMode(), tenant.user.role === "admin"),
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
  // legacy persona columns until the reader switch. Same for the Tools
  // store (T3): calls read the tile toggles + transferNumber.
  // The hidden columns (ids, personaConfig, Tools store, owner recap email)
  // live in ONE list: lib/agent/worker-runtime-config.ts.
  const { updatedAt, ...runtime } = workerRuntimeConfig(config);
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
  const clientProfilePromise = fx.getClientProfile(
    tenant.user.id,
    params.get("caller"),
  );
  // Forwarding setup check: an inbound PHONE call (?phone=, not the web
  // LiveTest) during the tenant's test window verifies forwarding.
  // Fire-and-forget, never delays the config.
  if (phone && !userId) {
    // fireSafely: a sync throw is caught too (a bare `void` only ignores the promise).
    void fireSafely(() =>
      fx.markForwardingTestCall(tenant.user.id, {
        forwardedFrom: params.get("forwardedFrom"),
        via: "call_start",
      }),
    );
  }
  const brain = await getAgentBrain(tenant.user.id, fx.reportUnreadable);
  const envOverride = process.env.AGENT_WEBHOOK_URL;
  const candidateWebhook =
    envOverride && envOverride.startsWith("http")
      ? {
          url: envOverride,
          ...(process.env.AGENT_WEBHOOK_SECRET
            ? { secret: process.env.AGENT_WEBHOOK_SECRET }
            : {}),
        }
      : toWorkerWebhook(brain);
  // SSRF guard: a webhook (tenant setting OR the global env override) whose
  // url fails checkAgentUrl is NOT served — the call gets the normal Tamara —
  // and the admins get one alert per source per day. Neither carries the url.
  // A short DNS budget here: this runs while the call is being set up (the
  // worker gives the whole config fetch 5 s). A slow or failed lookup means
  // the webhook is not served — the safe outcome (the normal Tamara answers).
  const { webhook: agentWebhook, refused } = await servedAgentWebhook(candidateWebhook, fx.urlCheck);
  if (refused) {
    const via = envOverride && envOverride.startsWith("http") ? "env_override" : "tenant_setting";
    await fx.logEvent({
      source: "tenant",
      event: "agent_webhook_unsafe",
      message: `Cerveau externe ignoré pour ${tenant.user.id} : adresse refusée (${refused})`,
      level: "error",
      userId: tenant.user.id,
      metadata: { via, code: refused },
    });
    // fireSafely: a sink that throws (sync or async) never fails the config.
    void fireSafely(() =>
      fx.alertAdmins({
        key: via === "env_override" ? "unsafe_agent_webhook:env" : `unsafe_agent_webhook:${tenant.user.id}`,
        subject: "External agent address refused",
        body:
          via === "env_override"
            ? "The global AGENT_WEBHOOK_URL is not a safe address. Calls use the normal Tamara until it is fixed."
            : `The external agent address of account ${tenant.user.id} is not a safe address. Its calls use the normal Tamara until it is changed.`,
        dedupMs: 24 * 60 * 60 * 1000,
        severity: "warning",
      }),
    );
  }
  if (agentWebhook) {
    await fx.logEvent({
      source: "tenant",
      event: "agent_brain_external",
      message: `Cerveau externe actif pour ${tenant.user.id} → ${agentWebhook.url}${envOverride ? " (AGENT_WEBHOOK_URL global override: every tenant goes there)" : ""}`,
      // The env override reroutes EVERY tenant to one endpoint with one
      // secret. Fine for a test, an incident if left on in prod: make it loud.
      level: envOverride ? "warn" : "info",
      userId: tenant.user.id,
      metadata: { via: envOverride ? "env_override" : "tenant_setting" },
    });
  }

  // "Ask your agent" (T5): served ONLY when active (CLIENT_AGENT on for this
  // account, switched on, usable url) AND the url passes the full check
  // (DNS) now — else the key is absent, as on main. The worker (T5c) reads it.
  // E1: the secret is opened only to serve; a sealed one that can't be
  // opened = the client agent is NOT served (fail closed, admins alerted).
  const opened = capabilities.clientAgent.active ? openClientAgentTools(tools, fx.reportUnreadable) : { tools, unreadable: false };
  let clientAgentField = opened.unreadable ? {} : clientAgentCallField(capabilities, opened.tools);
  if ("clientAgent" in clientAgentField) {
    const safe = await checkAgentUrl(tools.clientAgent.url, fx.urlCheck);
    if (!safe.ok) {
      clientAgentField = {};
      await fx.logEvent({
        source: "tenant",
        event: "client_agent_unsafe",
        message: `Agent du client ignoré pour ${tenant.user.id} : adresse refusée (${safe.code})`,
        level: "error",
        userId: tenant.user.id,
        metadata: { code: safe.code },
      });
    }
  }

  // Old own-agent mechanism ON + the new client agent set: the worker still
  // applies the old webhook, so the new brick is silently ignored → one admin
  // alert per account per day. Fire-and-forget and fail-open: never awaited,
  // never throws, reads only values computed above (the payload is unchanged).
  void alertLegacyBrainOverlapSafely({
    userId: tenant.user.id,
    brain,
    clientAgent: tools.clientAgent,
    alert: fx.alertAdmins,
  });

  // E2: the admin engine override of the account's reception product. No
  // override (or a client setting, or an ignored one) → apply false → the
  // voice below is today's, untouched. An ignored override alerts the admins.
  const todayVoice = servedInboundVoice(tenant.config, tenant.config.model || "gpt-realtime-2");
  // Fail-open: a throw inside the decision → apply false (today's bytes) + one alert.
  const { decision: engineDecision } = await decideEngineSafely(
    () => decideInboundEngine(tenant.user.id, tenant.config, fx.alertAdmins, fx.engineDeps),
    { path: "inbound", alert: fx.alertAdmins, today: inboundToday(tenant.config) },
  );
  const voiceConfig = engineDecision.apply ? voiceOnEngine(todayVoice, engineDecision) : todayVoice;
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
    ...clientAgentField,
    updatedAt,
    // Template per-call avec placeholders {date_fr}, {iso_date}, {time},
    // {caller_hint_block} substitués côté worker à chaque appel.
    perCallContextTemplate,
    greetingFallbackTemplate,
  });
}
