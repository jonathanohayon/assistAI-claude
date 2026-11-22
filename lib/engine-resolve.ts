// Which speech engine + model a call runs on: the PURE resolver of the engine
// override (E1). Client-safe, no I/O. NOTHING on the call path calls it yet:
// E2 wires it into the session-config handlers (before toEngineSettings).
//
// Resolution order (VP decision (i), binding):
//   1. CLIENT  — the account's own setting (agent_configs.realtime_provider
//                + agent_configs.model), only when "client setting set" holds
//                (see clientSettingSet below — E2 depends on that rule);
//   2. PRODUCT — the product override (a catalogue row, read by E2);
//   3. DEFAULT — today's global default (what every call runs on now).
// Each level above the default is SKIPPED, falling to the next one, when:
//   - the worker would not honour it for this product today (VP (ii),
//     honouredOptions below) → ignored.reason "not_honoured";
//   - it does not speak the account's language (VP (iii), unknown = not
//     supported, lib/engine-languages.ts) → ignored.reason "language".
// The first skipped choice is reported in `ignored` (every skipped choice in
// `ignoredAll`); E2 raises the admin alert. The default is never skipped:
// nothing lies below it. If it does not speak the language either, the
// caller sees it with engineSpeaks(result) — the resolver does not invent a
// fourth level.

import { engineSpeaks, type EngineLanguages } from "./engine-languages";
import { REALTIME_PROVIDER_MODEL, effectiveRealtimeProvider, type RealtimeProvider } from "./realtime-provider";
import type { Product } from "./product-values";

// ── "Client setting set" ──────────────────────────────────────────────────

/**
 * The agent_configs.model column default (lib/db/schema.ts, migration 0012
 * `SET DEFAULT 'gpt-realtime-2'`, which also rewrote every row still on the
 * old 'gpt-realtime-mini' default). Every tenant that nobody touched holds it.
 */
export const CLIENT_DEFAULT_MODEL = "gpt-realtime-2";

export type ClientEngineColumns = {
  /** agent_configs.realtime_provider: NULL (= openai) for almost every tenant. */
  realtimeProvider: string | null | undefined;
  /** agent_configs.model: NOT NULL, default 'gpt-realtime-2', OpenAI-only. */
  model: string | null | undefined;
};

/**
 * ═══ THE "CLIENT SETTING SET" RULE (E2 depends on it) ═══
 *
 * A client counts as having its OWN engine setting iff EITHER
 *   (a) realtime_provider names a non-OpenAI engine ("gemini" | "xai"); or
 *   (b) the engine is OpenAI (realtime_provider NULL, "openai", or unknown —
 *       effectiveRealtimeProvider) AND model, trimmed, is non-empty and
 *       DIFFERENT from the column default 'gpt-realtime-2'.
 * Otherwise (NULL provider + default/empty model) the client is NOT set and
 * the product override applies.
 *
 * Why: realtime_provider is NULL for most tenants and model is NOT NULL with
 * a default, so "column non-null" would make every tenant client-set and
 * block every product override. Both columns are admin-only writes
 * (PUT /api/admin/configs/:userId, an admin's /api/dashboard/config), so a
 * non-default value is always a deliberate admin choice.
 * Accepted consequence: an admin who explicitly picks "OpenAI gpt-realtime-2
 * (default)" stores exactly the default image, which is indistinguishable
 * from an untouched tenant → treated as NOT set (the picker labels it the
 * default, so following the product override is the expected reading).
 * Case and whitespace: the provider is read through effectiveRealtimeProvider
 * (exact "gemini" / "xai", as parseRealtimeProvider stores them); the model
 * is trimmed before comparing.
 */
export function clientSettingSet(c: ClientEngineColumns | null | undefined): boolean {
  if (!c) return false;
  if (effectiveRealtimeProvider(c.realtimeProvider) !== "openai") return true;
  const m = (c.model ?? "").trim();
  return m !== "" && m !== CLIENT_DEFAULT_MODEL;
}

// ── Honoured options (VP (ii)) ────────────────────────────────────────────

export type EngineHonour = {
  /** The worker runs this engine for this product when asked. */
  engine: boolean;
  /**
   * Models the worker runs when asked: "any" (it uses the served model), or
   * the only one it runs (Gemini / Grok: its env model, whatever is served).
   * Empty when the engine itself is not honoured.
   */
  models: "any" | readonly string[];
};
export type HonouredOptions = Record<RealtimeProvider, EngineHonour>;

const NONE: EngineHonour = { engine: false, models: [] };

/**
 * Which engine/model choices the worker honours TODAY, per product (worker
 * origin/main, 2026-11-22), for the admin screen to disable the rest:
 *   reception, reception_multi — the inbound config (phone / web / call_me)
 *     carries realtimeProvider + model: OpenAI any model; Gemini / Grok yes,
 *     but only on the worker's env model (a forced model is ignored);
 *   sales — campaign / outbound_test payloads carry no realtimeProvider:
 *     OpenAI only (they carry `model`, which the worker uses);
 *   connect — vox calls never hit the web config: no override honoured.
 * Pure; the result is a fresh object.
 */
export function honouredOptions(product: Product): HonouredOptions {
  switch (product) {
    case "reception":
    case "reception_multi":
      return {
        openai: { engine: true, models: "any" },
        gemini: { engine: true, models: [REALTIME_PROVIDER_MODEL.gemini] },
        xai: { engine: true, models: [REALTIME_PROVIDER_MODEL.xai] },
      };
    case "sales":
      return { openai: { engine: true, models: "any" }, gemini: { ...NONE }, xai: { ...NONE } };
    case "connect":
      return { openai: { ...NONE }, gemini: { ...NONE }, xai: { ...NONE } };
  }
}

/** Is this engine/model choice honoured? A null model = the engine's own default. */
export function isHonoured(h: HonouredOptions, engine: RealtimeProvider, model: string | null): boolean {
  const e = h[engine];
  if (!e?.engine) return false;
  if (model === null || e.models === "any") return true;
  return e.models.includes(model);
}

// ── The resolver ──────────────────────────────────────────────────────────

export type EngineChoice = { engine: RealtimeProvider; model: string };
export type EngineSource = "client" | "product" | "default";
export type IgnoredChoice = {
  reason: "language" | "not_honoured";
  wanted: { source: Exclude<EngineSource, "default">; engine: RealtimeProvider; model: string | null };
};

export type ResolveEngineInput = {
  product: Product;
  /** The account's agent_configs columns (null = no row). */
  client: ClientEngineColumns | null;
  /** The product override (null = none). model null = the engine's default. */
  productOverride: { engine: RealtimeProvider; model: string | null } | null;
  /** Today's global default (openai + the served default model). */
  globalDefault: EngineChoice;
  /** The account's language (agent_configs / users primary language). */
  language: string;
  languages: EngineLanguages;
  honoured: HonouredOptions;
};

export type ResolvedEngine = EngineChoice & {
  source: EngineSource;
  /** The first (highest-priority) choice that was skipped, if any. */
  ignored?: IgnoredChoice;
  /** Every skipped choice, in priority order (present iff `ignored` is). */
  ignoredAll?: IgnoredChoice[];
};

/** The model a choice runs on: the forced one, else the engine's default. */
function modelOf(engine: RealtimeProvider, forced: string | null, globalDefault: EngineChoice): string {
  if (forced) return forced;
  return engine === globalDefault.engine ? globalDefault.model : REALTIME_PROVIDER_MODEL[engine];
}

/**
 * The client's choice as (engine, forced model | null). agent_configs.model is
 * the OpenAI model: for Gemini / Grok it is not a forced model (it is unused
 * by the worker), so the forced model is null = the engine's default.
 */
function clientChoice(c: ClientEngineColumns): { engine: RealtimeProvider; model: string | null } {
  const engine = effectiveRealtimeProvider(c.realtimeProvider);
  if (engine !== "openai") return { engine, model: null };
  const m = (c.model ?? "").trim();
  return { engine, model: m === "" ? null : m };
}

export function resolveEngine(input: ResolveEngineInput): ResolvedEngine {
  const { client, productOverride, globalDefault, language, languages, honoured } = input;
  const candidates: Array<{ source: Exclude<EngineSource, "default">; engine: RealtimeProvider; model: string | null }> = [];
  if (client && clientSettingSet(client)) candidates.push({ source: "client", ...clientChoice(client) });
  if (productOverride) {
    candidates.push({ source: "product", engine: productOverride.engine, model: productOverride.model?.trim() || null });
  }
  const ignoredAll: IgnoredChoice[] = [];
  for (const c of candidates) {
    const model = modelOf(c.engine, c.model, globalDefault);
    let reason: IgnoredChoice["reason"] | null = null;
    // A forced model equal to the engine's honoured default is no forcing.
    if (!isHonoured(honoured, c.engine, c.model === null ? null : model)) reason = "not_honoured";
    else if (!engineSpeaks(c.engine, model, language, languages)) reason = "language";
    if (reason === null) {
      return {
        engine: c.engine,
        model,
        source: c.source,
        ...(ignoredAll.length ? { ignored: ignoredAll[0], ignoredAll } : {}),
      };
    }
    ignoredAll.push({ reason, wanted: { source: c.source, engine: c.engine, model: c.model } });
  }
  return {
    engine: globalDefault.engine,
    model: globalDefault.model,
    source: "default",
    ...(ignoredAll.length ? { ignored: ignoredAll[0], ignoredAll } : {}),
  };
}
