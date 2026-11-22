// ADMIN-ONLY engine override screens (catalogue "Moteur imposé" lines and the
// tenant banner line): the pure part — labels, option rows, the language
// warning, the cost label, the PUT bodies and the 400 field mapping.
// It names engines: only app/admin imports it (pinned by
// scripts/tests/engine-override-admin-ui.test.ts), never a tenant page.
//
// Rules (VP, 22/11):
//   - an option the worker doesn't honour today is DISABLED with one line
//     (NOT_HONOURED_LINE), never selectable-and-ignored;
//   - languages come from the server's option data; UNKNOWN = NOT SUPPORTED;
//   - every cost figure is a rate-card ESTIMATION (lib/finance/rates.ts: the
//     whole rate card is estimated, nothing is measured yet) → "estimation"
//     next to it; no figure → "—". Never an invented number.

import type { Product, ProductEntry } from "@/lib/product-values";
import type { RealtimeProvider } from "@/lib/realtime-provider";

export const ENGINES: readonly RealtimeProvider[] = ["openai", "gemini", "xai"];

export const ENGINE_LABEL: Record<RealtimeProvider, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  xai: "Grok (xAI)",
};

export const ENTRY_LABEL: Record<ProductEntry, string> = {
  reception: "Réception",
  sales: "Ventes",
  connect: "Connecter votre agent",
};

/** The three catalogue lines; Réception writes reception AND reception_multi. */
export const CATALOGUE_LINES: ReadonlyArray<{ entry: ProductEntry; products: readonly Product[] }> = [
  { entry: "reception", products: ["reception", "reception_multi"] },
  { entry: "sales", products: ["sales"] },
  { entry: "connect", products: ["connect"] },
];

/** The languages a product is sold in (i18n/routing locales): the catalogue warning checks all of them. */
export const PRODUCT_LANGUAGES: readonly string[] = ["fr", "he", "en"];

export const NOT_HONOURED_LINE = "Pas encore pris en charge pour ce produit.";
export const NONE_LABEL = "Aucun (choix du compte)";

const LANGUAGE_NAME: Record<string, string> = { fr: "français", en: "anglais", he: "hébreu" };
export const languageName = (l: string) => LANGUAGE_NAME[l] ?? l;

// ── Server shapes ──────────────────────────────────────────────────────────

export type EngineOverride = { engine: RealtimeProvider; model: string | null };
export type EngineOption = { engine: RealtimeProvider; model: string | null; honoured: boolean; languages: string[] };
export type ProductEngineOptions = { honoured?: unknown; options: EngineOption[] };
/** GET /api/admin/product-catalogue (the parts these screens read). */
export type CatalogueEngineData = {
  engineOverrides: Record<Product, EngineOverride | null>;
  engineOptions: Record<Product, ProductEngineOptions>;
};

export type EngineSource = "client" | "product" | "default";
export type IgnoredChoice = {
  reason: "language" | "not_honoured";
  wanted: { source: string; engine: RealtimeProvider; model: string | null };
};
export type ResolvedRow = {
  language: string;
  resolved: { engine: RealtimeProvider; model: string; source: EngineSource };
  ignored?: IgnoredChoice;
  costPerMinUsd: number | null;
};
export type BannerProduct =
  | ({ entry: ProductEntry; product: Product; byLanguage?: ResolvedRow[] } & ResolvedRow)
  | { entry: ProductEntry; product: Product; resolved: null; costPerMinUsd: null; language?: string };
/** GET /api/admin/users/[userId]/engine. */
export type BannerEngineData = { userId: string; salesOverride: EngineOverride | null; products: BannerProduct[] };

// ── Labels ─────────────────────────────────────────────────────────────────

export const SOURCE_LABEL: Record<EngineSource, string> = {
  client: "imposé pour ce client",
  product: "imposé pour le produit",
  default: "choix du compte",
};

export function modelLabel(model: string | null): string {
  return model ?? "modèle par défaut du moteur";
}

export function engineChoiceLabel(engine: RealtimeProvider, model: string | null): string {
  return `${ENGINE_LABEL[engine]} · ${modelLabel(model)}`;
}

/**
 * The cost label of a rate-card figure: null → "—"; else the USD/min figure
 * with "estimation" (the rate card holds no measured figure today).
 */
export function costLabel(costPerMinUsd: number | null | undefined): string {
  if (costPerMinUsd === null || costPerMinUsd === undefined || !Number.isFinite(costPerMinUsd)) return "—";
  const n = costPerMinUsd.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return `${n} $/min · estimation`;
}

// ── Option rows ────────────────────────────────────────────────────────────

const sameModel = (a: string | null, b: string | null) => (a ?? null) === (b ?? null);

export function findOption(options: readonly EngineOption[], choice: EngineOverride | null): EngineOption | null {
  if (!choice) return null;
  return options.find((o) => o.engine === choice.engine && sameModel(o.model, choice.model)) ?? null;
}

/** An engine is selectable iff at least one of its options is honoured. */
export function engineSelectable(options: readonly EngineOption[], engine: RealtimeProvider): boolean {
  return options.some((o) => o.engine === engine && o.honoured);
}

export function modelsOf(options: readonly EngineOption[], engine: RealtimeProvider): EngineOption[] {
  return options.filter((o) => o.engine === engine);
}

/** The labels of the disabled engines and models of a line (for its one "why" line). */
export function disabledChoices(options: readonly EngineOption[], engine: RealtimeProvider | null): string[] {
  const out: string[] = [];
  for (const e of ENGINES) {
    if (!options.some((o) => o.engine === e)) continue;
    if (!engineSelectable(options, e)) out.push(ENGINE_LABEL[e]);
  }
  if (engine && engineSelectable(options, engine)) {
    for (const o of modelsOf(options, engine)) if (!o.honoured) out.push(engineChoiceLabel(o.engine, o.model));
  }
  return out;
}

/** The choice after picking an engine: its first honoured option (null model first). */
export function pickEngine(options: readonly EngineOption[], engine: RealtimeProvider | ""): EngineOverride | null {
  if (engine === "") return null;
  const o = modelsOf(options, engine).find((x) => x.honoured);
  return o ? { engine: o.engine, model: o.model } : null;
}

/** The choice after picking a model (only an honoured one is accepted). */
export function pickModel(options: readonly EngineOption[], engine: RealtimeProvider, model: string | null): EngineOverride | null {
  const o = findOption(options, { engine, model });
  return o && o.honoured ? { engine, model } : null;
}

// ── Language warning ───────────────────────────────────────────────────────

/**
 * The languages (of `needed`) the chosen option does NOT speak. Unknown =
 * not supported: an option absent from the server's data speaks nothing.
 */
export function missingLanguages(options: readonly EngineOption[], choice: EngineOverride | null, needed: readonly string[]): string[] {
  if (!choice) return [];
  const spoken = new Set(findOption(options, choice)?.languages ?? []);
  return [...new Set(needed)].filter((l) => !spoken.has(l));
}

export function languageWarning(missing: readonly string[], scope: "product" | "account"): string | null {
  if (!missing.length) return null;
  const names = missing.map(languageName).join(", ");
  return scope === "product"
    ? `Ce moteur ne parle pas : ${names} (langue inconnue = non prise en charge). Pour les comptes dans cette langue, le moteur imposé sera ignoré et une alerte admin sera levée.`
    : `Ce moteur ne parle pas : ${names} (langue inconnue = non prise en charge). Pour ce compte, le moteur imposé sera ignoré et une alerte admin sera levée.`;
}

/** The server's own `ignored` flag, in plain French. */
export function ignoredLine(ig: IgnoredChoice | undefined, language: string): string | null {
  if (!ig) return null;
  const what = engineChoiceLabel(ig.wanted.engine, ig.wanted.model);
  return ig.reason === "language"
    ? `Moteur imposé ignoré (${what}) : il ne parle pas ${languageName(language)}. Une alerte admin est levée à l'appel.`
    : `Moteur imposé ignoré (${what}) : ${NOT_HONOURED_LINE}`;
}

// ── PUT bodies ─────────────────────────────────────────────────────────────

const sameChoice = (a: EngineOverride | null, b: EngineOverride | null) =>
  a === null || b === null ? a === b : a.engine === b.engine && sameModel(a.model, b.model);

/**
 * PUT /api/admin/users/[id]/engine body: unchanged → {} (salesOverride
 * omitted = unchanged); else the object (set) or null (clear).
 */
export function salesPutBody(stored: EngineOverride | null, chosen: EngineOverride | null): { salesOverride?: EngineOverride | null } {
  if (sameChoice(stored, chosen)) return {};
  return { salesOverride: chosen ? { engine: chosen.engine, model: chosen.model } : null };
}

/**
 * PUT /api/admin/product-catalogue body: only the products whose override
 * changed (omitted = kept), each `{ engineOverride: obj | null }`; no price
 * field is ever sent.
 */
export function cataloguePutBody(
  stored: Record<Product, EngineOverride | null>,
  chosen: Partial<Record<ProductEntry, EngineOverride | null>>,
): { catalogue: Partial<Record<Product, { engineOverride: EngineOverride | null }>> } {
  const catalogue: Partial<Record<Product, { engineOverride: EngineOverride | null }>> = {};
  for (const line of CATALOGUE_LINES) {
    if (!(line.entry in chosen)) continue;
    const c = chosen[line.entry] ?? null;
    for (const p of line.products) {
      if (sameChoice(stored[p] ?? null, c)) continue;
      catalogue[p] = { engineOverride: c ? { engine: c.engine, model: c.model } : null };
    }
  }
  return { catalogue };
}

// ── 400 field errors ───────────────────────────────────────────────────────

export type FieldSlot = "engine" | "model" | "line";

/** Banner: `salesOverride.engine|model` → that select; `salesOverride` / anything else → the line. */
export function salesFieldErrors(fields: readonly string[]): Partial<Record<FieldSlot, string>> {
  const out: Partial<Record<FieldSlot, string>> = {};
  for (const f of fields) {
    if (f === "salesOverride.engine") out.engine = "Moteur refusé par le serveur.";
    else if (f === "salesOverride.model") out.model = "Modèle refusé par le serveur.";
    else out.line = `Valeur refusée par le serveur (${f}).`;
  }
  return out;
}

/** Catalogue: `catalogue.<product>.engineOverride[.engine|.model]` → that line's select; others → the form. */
export function catalogueFieldErrors(fields: readonly string[]): {
  byEntry: Partial<Record<ProductEntry, Partial<Record<FieldSlot, string>>>>;
  other: string[];
} {
  const byEntry: Partial<Record<ProductEntry, Partial<Record<FieldSlot, string>>>> = {};
  const other: string[] = [];
  for (const f of fields) {
    const m = /^catalogue\.([a-z_]+)\.engineOverride(?:\.(engine|model))?$/.exec(f);
    const line = m ? CATALOGUE_LINES.find((l) => (l.products as readonly string[]).includes(m[1]!)) : undefined;
    if (!m || !line) {
      other.push(f);
      continue;
    }
    const slot: FieldSlot = (m[2] as FieldSlot | undefined) ?? "line";
    const msg = slot === "engine" ? "Moteur refusé par le serveur." : slot === "model" ? "Modèle refusé par le serveur." : "Valeur refusée par le serveur.";
    byEntry[line.entry] = { ...byEntry[line.entry], [slot]: msg };
  }
  return { byEntry, other };
}

// ── Save helpers (fetch injected: tests drive them with a fake) ─────────────

export type SaveResult =
  | { ok: true; json: unknown }
  | { ok: false; kind: "fields"; fields: string[] }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "error"; message: string };

export async function putJson(fetchFn: typeof fetch, url: string, body: unknown): Promise<SaveResult> {
  let res: Response;
  try {
    res = await fetchFn(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, kind: "error", message: "Le serveur ne répond pas." };
  }
  const json = (await res.json().catch(() => null)) as { error?: string; fields?: unknown } | null;
  if (res.ok) return { ok: true, json };
  if (res.status === 404) return { ok: false, kind: "not_found" };
  if (res.status === 400 && Array.isArray(json?.fields)) return { ok: false, kind: "fields", fields: json.fields.filter((x): x is string => typeof x === "string") };
  return { ok: false, kind: "error", message: `Erreur ${res.status}${json?.error ? ` (${json.error})` : ""}.` };
}

export const NOT_FOUND_LINE = "Compte introuvable : il a peut-être été supprimé.";
