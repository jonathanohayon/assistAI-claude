// Which languages each speech engine speaks, as admin-editable DATA (E1 of
// the engine override). CLIENT-SAFE: no lib/db here; storage lives in
// lib/engine-languages-storage.ts (server-only).
//
// Shape: engine → (model id | "*") → the supported language codes.
//   "*"       the engine's languages for any model without its own entry
//             (required for every engine);
//   "<model>" an optional per-model entry that REPLACES "*" for that model.
//
// Rule (VP, binding): UNKNOWN = NOT SUPPORTED. A language absent from the
// list, an unknown engine, or a malformed language → engineSpeaks() = false.
// Defaults (VP, 2026-11):
//   openai  fr / en / he
//   xai     fr / en      (no Hebrew: xAI documents none)
//   gemini  fr / en      (Hebrew unknown → not supported until verified)
//
// Stored in app_settings "engine_languages_v1" as the full table. Absent →
// defaults; a row that fails the strict parse → defaults + an admin alert.

import { REALTIME_PROVIDERS, type RealtimeProvider } from "./realtime-provider";

/** The wildcard entry: the engine's languages for any model without its own. */
export const ANY_MODEL = "*";

/** model id | "*" → language codes (lowercase ISO 639-1, unique). */
export type EngineLanguageEntry = Record<string, string[]>;
export type EngineLanguages = Record<RealtimeProvider, EngineLanguageEntry>;

export const DEFAULT_ENGINE_LANGUAGES: EngineLanguages = {
  openai: { [ANY_MODEL]: ["fr", "en", "he"] },
  gemini: { [ANY_MODEL]: ["fr", "en"] },
  xai: { [ANY_MODEL]: ["fr", "en"] },
};

/** A fresh deep copy of the defaults (callers may mutate it). */
export function defaultEngineLanguages(): EngineLanguages {
  return structuredClone(DEFAULT_ENGINE_LANGUAGES);
}

const LANGUAGE_RE = /^[a-z]{2}$/;
// Model ids as the catalogue writes them (gpt-realtime-2.1, gemini-3.8-live,
// grok-voice-3.0): letters, digits, dot, dash, underscore. Bounded length.
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const isEngine = (e: string): e is RealtimeProvider => (REALTIME_PROVIDERS as readonly string[]).includes(e);
const isModelKey = (k: string) => k === ANY_MODEL || MODEL_RE.test(k);

/** A valid language list: an array of unique lowercase 2-letter codes (may be empty). */
function parseLanguageList(x: unknown): string[] | null {
  if (!Array.isArray(x)) return null;
  if (!x.every((l) => typeof l === "string" && LANGUAGE_RE.test(l))) return null;
  if (new Set(x).size !== x.length) return null;
  return [...(x as string[])];
}

/**
 * STRICT parse of a full table: exactly the three engines, each a plain
 * object with a "*" entry, every key "*" or a model id, every value a valid
 * language list. Anything else → null (no filling from the defaults: the
 * caller decides).
 */
export function parseEngineLanguages(x: unknown): EngineLanguages | null {
  if (!isPlainObject(x)) return null;
  const keys = Object.keys(x);
  if (keys.length !== REALTIME_PROVIDERS.length || !REALTIME_PROVIDERS.every((e) => Object.prototype.hasOwnProperty.call(x, e))) return null;
  const out = {} as EngineLanguages;
  for (const e of REALTIME_PROVIDERS) {
    const entry = x[e];
    if (!isPlainObject(entry) || !Object.prototype.hasOwnProperty.call(entry, ANY_MODEL)) return null;
    const parsed: EngineLanguageEntry = {};
    for (const [k, v] of Object.entries(entry)) {
      if (!isModelKey(k)) return null;
      const list = parseLanguageList(v);
      if (!list) return null;
      parsed[k] = list;
    }
    out[e] = parsed;
  }
  return out;
}

export type StoredEngineLanguages = {
  languages: EngineLanguages;
  source: "stored" | "default" | "invalid";
};

/** The table from the raw app_settings value: absent → defaults; invalid → defaults, flagged. Pure. */
export function engineLanguagesFromStored(raw: string | null): StoredEngineLanguages {
  if (raw == null) return { languages: defaultEngineLanguages(), source: "default" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { languages: defaultEngineLanguages(), source: "invalid" };
  }
  const t = parseEngineLanguages(parsed);
  return t ? { languages: t, source: "stored" } : { languages: defaultEngineLanguages(), source: "invalid" };
}

/** The languages an engine/model speaks: its own model entry, else "*", else none. */
export function engineLanguagesFor(
  engine: string,
  model: string | null | undefined,
  table: EngineLanguages,
): readonly string[] {
  if (!isEngine(engine)) return [];
  const entry = table[engine];
  if (!entry) return [];
  if (model && Object.prototype.hasOwnProperty.call(entry, model)) return entry[model] ?? [];
  return entry[ANY_MODEL] ?? [];
}

/**
 * Does this engine (and model) speak this language? UNKNOWN = NOT SUPPORTED:
 * an unknown engine, a language not listed, or a non-string language → false.
 * The language is compared lowercased and trimmed ("FR " = "fr").
 */
export function engineSpeaks(
  engine: string,
  model: string | null | undefined,
  language: unknown,
  table: EngineLanguages,
): boolean {
  if (typeof language !== "string") return false;
  const l = language.trim().toLowerCase();
  if (!LANGUAGE_RE.test(l)) return false;
  return engineLanguagesFor(engine, model, table).includes(l);
}

/** One edited entry, for the admin edit log: no PII, only engine/model and the lists. */
export type EngineLanguageChange = {
  engine: RealtimeProvider;
  model: string;
  /** null = the entry did not exist. */
  before: string[] | null;
  /** null = the entry was removed. */
  after: string[] | null;
};

export type EngineLanguagesWrite =
  | { ok: true; value: EngineLanguages; changed: boolean; changes: EngineLanguageChange[] }
  | { ok: false; error: "invalid_engine_languages"; fields: string[] };

const sameList = (a: readonly string[] | null, b: readonly string[] | null) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * The admin write, from the RAW parsed body: `{ languages: <partial> }`.
 *   - only the engines / model entries PRESENT are written; everything
 *     omitted keeps its stored value (an empty body changes nothing);
 *   - a present entry is a language list (replaces it), or null to REMOVE a
 *     per-model entry ("*" cannot be removed, only replaced);
 *   - any unknown key, unknown engine, bad model id or bad list → refused
 *     with every offending path named, nothing written.
 * `changes` lists every entry whose list actually changed (before/after).
 */
export function engineLanguagesWrite(stored: EngineLanguages, body: unknown): EngineLanguagesWrite {
  const fail = (fields: string[]): EngineLanguagesWrite => ({ ok: false, error: "invalid_engine_languages", fields });
  if (!isPlainObject(body)) return fail(["body"]);
  const bad = Object.keys(body).filter((k) => k !== "languages");
  const next = structuredClone(stored);
  const changes: EngineLanguageChange[] = [];
  const patch = body.languages;
  if (patch === undefined) return bad.length ? fail(bad) : { ok: true, value: next, changed: false, changes };
  if (!isPlainObject(patch)) return fail([...bad, "languages"]);
  for (const [e, entry] of Object.entries(patch)) {
    if (!isEngine(e) || !isPlainObject(entry)) {
      bad.push(`languages.${e}`);
      continue;
    }
    for (const [m, v] of Object.entries(entry)) {
      const path = `languages.${e}.${m}`;
      if (!isModelKey(m)) {
        bad.push(path);
        continue;
      }
      const before = Object.prototype.hasOwnProperty.call(next[e], m) ? next[e][m]! : null;
      if (v === null) {
        if (m === ANY_MODEL) {
          bad.push(path);
          continue;
        }
        delete next[e][m];
        if (before !== null) changes.push({ engine: e, model: m, before, after: null });
        continue;
      }
      const list = parseLanguageList(v);
      if (!list) {
        bad.push(path);
        continue;
      }
      next[e][m] = list;
      if (!sameList(before, list)) changes.push({ engine: e, model: m, before, after: list });
    }
  }
  if (bad.length) return fail(bad);
  return { ok: true, value: next, changed: changes.length > 0, changes };
}
