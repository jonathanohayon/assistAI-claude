// The admin ENGINE OVERRIDE per product (E2): its shape, its validation, and
// the ONE decision the call path and the admin screen share (engineForCall).
// CLIENT-SAFE and pure: no lib/db, no env. The storage is the product
// catalogue row (lib/product-catalogue.ts, additive `engineOverride` per
// product); the handlers' I/O lives in lib/engine-override-load.ts.
//
// THE SAFETY RULE (binding): when the product has NO override, engineForCall
// returns `apply: false` and the handlers run EXACTLY today's code path (they
// do not route through the resolver at all). Only `apply: true` changes a
// payload, and only in today's fields (voiceConfig + the legacy engine
// fields); no new field is ever served.
//
// Resolution when an override IS set (VP, binding):
//   inbound (reception / reception_multi)
//     - client setting set (lib/engine-resolve.ts clientSettingSet) → today's
//       path, untouched (the client's own engine wins);
//     - else the override, if honoured and it speaks the account's language;
//     - else today's path + `ignored` (the caller alerts the admins).
//   sales (campaign / outbound_test)
//     - the client setting is NOT considered: agent_configs.realtime_provider
//       + model are the RECEPTIONIST's engine and were never applied to an
//       outbound call (campaign / outbound_test run on the env model), so they
//       cannot outrank a sales override;
//     - else the override (OpenAI models only), if it speaks the language;
//     - else today's path + `ignored`.
//   connect: never an override (honouredOptions = nothing).

import { ANY_MODEL, engineLanguagesFor, type EngineLanguages } from "./engine-languages";
import {
  clientSettingSet,
  honouredOptions,
  isHonoured,
  resolveEngine,
  type ClientEngineColumns,
  type EngineChoice,
  type HonouredOptions,
  type IgnoredChoice,
} from "./engine-resolve";
import { PRODUCTS, type Product } from "./product-values";
import { REALTIME_PROVIDER_MODEL, REALTIME_PROVIDERS, type RealtimeProvider } from "./realtime-provider";

// ── Shape + validation ─────────────────────────────────────────────────────

/** A product override. model null = the engine's own default model. */
export type EngineOverride = { engine: RealtimeProvider; model: string | null };
export type EngineOverrides = Record<Product, EngineOverride | null>;

export function noEngineOverrides(): EngineOverrides {
  return { reception: null, reception_multi: null, sales: null, connect: null };
}

/** True when no product has an override (the stored row stays today's bytes). */
export function hasAnyEngineOverride(o: EngineOverrides): boolean {
  return PRODUCTS.some((p) => o[p] !== null);
}

// Model ids as lib/engine-languages.ts accepts them (bounded, no spaces).
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * STRICT shape parse of a stored/sent override: exactly `{ engine, model }`,
 * engine one of the three engines, model null or a model id. Whether the
 * worker honours it is a separate check (engineOverrideProblems).
 */
export function parseEngineOverride(x: unknown): EngineOverride | null {
  if (!isPlainObject(x)) return null;
  const keys = Object.keys(x).sort();
  if (keys.length !== 2 || keys[0] !== "engine" || keys[1] !== "model") return null;
  if (typeof x.engine !== "string" || !(REALTIME_PROVIDERS as readonly string[]).includes(x.engine)) return null;
  if (x.model !== null && (typeof x.model !== "string" || !MODEL_RE.test(x.model))) return null;
  return { engine: x.engine as RealtimeProvider, model: x.model as string | null };
}

/**
 * Why an override can't be written for this product (VP (ii): an option the
 * worker doesn't honour is NEVER served, so it is refused at write): the
 * offending sub-paths ("engine" / "model"), empty = writable.
 */
export function engineOverrideProblems(product: Product, o: EngineOverride): Array<"engine" | "model"> {
  const h = honouredOptions(product);
  if (!h[o.engine].engine) return ["engine"];
  if (!isHonoured(h, o.engine, o.model)) return ["model"];
  return [];
}

// ── The decision ───────────────────────────────────────────────────────────

export type CallPath = "inbound" | "campaign" | "outbound_test";

/** The product a call path bills/answers as. Inbound: the account's reception product. */
export function productForPath(path: CallPath, entitled: readonly Product[]): Product | null {
  if (path !== "inbound") return "sales";
  if (entitled.includes("reception_multi")) return "reception_multi";
  if (entitled.includes("reception")) return "reception";
  return null;
}

export type EngineForCallInput = {
  path: CallPath;
  /** The product of this call (productForPath), null = none (today's path). */
  product: Product | null;
  /** The account's agent_configs engine columns (inbound only; ignored for sales). */
  client: ClientEngineColumns | null;
  /**
   * E2b hook (VP 2026-11-22): a SALES-only client override, ranked above the
   * product override on campaign / outbound_test. Always null in E2 (no
   * storage yet); ignored on the inbound path.
   */
  clientSalesOverride?: EngineOverride | null;
  overrides: EngineOverrides;
  /** The language of this call (inbound: agent_configs.primary_language; sales: the agent's). */
  language: string;
  languages: EngineLanguages;
  /**
   * What the call runs on TODAY (the handler's own values): inbound = the
   * effective provider + the tenant's model; sales = openai + the env model.
   */
  today: EngineChoice;
};

export type EngineSourceForCall = "client" | "product" | "default";

export type EngineForCall = {
  /** false = the handler runs today's code path verbatim. */
  apply: boolean;
  /** The engine the call runs on. */
  engine: RealtimeProvider;
  /** The model the call runs on (Gemini / Grok: the worker's env model). */
  model: string;
  /**
   * The model value served in today's `model` field when apply: the resolved
   * OpenAI model; for Gemini / Grok the account's own value is kept (the
   * worker runs its env model; a Gemini/Grok model value is never served).
   */
  servedModel: string;
  source: EngineSourceForCall;
  /** The override that was skipped (language / not honoured): the caller alerts. */
  ignored?: IgnoredChoice;
};

/** The model an engine really runs on (for display / cost): Gemini / Grok = the worker's env model. */
function runningModel(engine: RealtimeProvider, model: string): string {
  return engine === "openai" ? model : REALTIME_PROVIDER_MODEL[engine];
}

export function engineForCall(input: EngineForCallInput): EngineForCall {
  const { path, product, client, overrides, language, languages, today } = input;
  const todaySource: EngineSourceForCall = path === "inbound" && clientSettingSet(client) ? "client" : "default";
  const todayResult = (ignored?: IgnoredChoice): EngineForCall => ({
    apply: false,
    engine: today.engine,
    model: runningModel(today.engine, today.model),
    servedModel: today.model,
    source: todaySource,
    ...(ignored ? { ignored } : {}),
  });
  const override = product ? overrides[product] : null;
  const salesClient = path !== "inbound" ? (input.clientSalesOverride ?? null) : null;
  // THE SAFETY RULE: no override → today's path, nothing resolved.
  if (!product || (!override && !salesClient)) return todayResult();
  // Inbound: a client setting wins over the product override, as today.
  if (todaySource === "client") return todayResult();
  // Candidates in priority order. Sales: the E2b client sales override
  // (always null in E2), then the product override. Inbound: the product
  // override (the client setting was handled above).
  const candidates: Array<{ source: "client" | "product"; choice: EngineOverride }> = [];
  if (salesClient) candidates.push({ source: "client", choice: salesClient });
  if (override) candidates.push({ source: "product", choice: override });
  let ignored: IgnoredChoice | undefined;
  for (const c of candidates) {
    // One level through the shared resolver: the language and not-honoured
    // guards are resolveEngine's own (client columns null: not a level here).
    const r = resolveEngine({
      product,
      client: null,
      productOverride: c.choice,
      globalDefault: today,
      language,
      languages,
      honoured: honouredOptions(product),
    });
    if (r.source !== "product") {
      if (!ignored && r.ignored) ignored = { ...r.ignored, wanted: { ...r.ignored.wanted, source: c.source } };
      continue;
    }
    // A choice equal to today's values is no change: today's path, verbatim.
    if (r.engine === today.engine && r.model === today.model) return todayResult(ignored);
    return {
      apply: true,
      engine: r.engine,
      model: runningModel(r.engine, r.model),
      servedModel: r.engine === "openai" ? r.model : today.model,
      source: c.source,
      ...(ignored ? { ignored } : {}),
    };
  }
  return todayResult(ignored);
}

// ── Admin screen helpers ───────────────────────────────────────────────────

export type EngineOptionCoverage = {
  engine: RealtimeProvider;
  /** null = the engine's own default model. */
  model: string | null;
  honoured: boolean;
  /** The languages this option speaks (engine_languages table; unknown = none). */
  languages: string[];
};

/** Known OpenAI model ids worth offering (the admin picker's), plus the table's own model keys. */
const OPENAI_OPTION_MODELS = ["gpt-realtime-2", "gpt-realtime-2.1"];

/**
 * Per product, every option the admin form can offer (engine × model), with
 * whether the worker honours it for that product and the languages it
 * speaks — so the form disables what would be refused and warns before saving.
 */
export function engineOptionCoverage(product: Product, languages: EngineLanguages): EngineOptionCoverage[] {
  const h: HonouredOptions = honouredOptions(product);
  const out: EngineOptionCoverage[] = [];
  for (const engine of REALTIME_PROVIDERS) {
    const tableModels = Object.keys(languages[engine] ?? {}).filter((k) => k !== ANY_MODEL);
    const own = engine === "openai" ? OPENAI_OPTION_MODELS : [REALTIME_PROVIDER_MODEL[engine]];
    const models = [...new Set([...own, ...tableModels])];
    out.push({ engine, model: null, honoured: isHonoured(h, engine, null), languages: [...engineLanguagesFor(engine, null, languages)] });
    for (const model of models) {
      out.push({ engine, model, honoured: isHonoured(h, engine, model), languages: [...engineLanguagesFor(engine, model, languages)] });
    }
  }
  return out;
}
