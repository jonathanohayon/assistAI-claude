// ADMIN-ONLY "Catalogue des produits" → prices and minutes. Pure logic of the
// form (app/admin/engine-override/ProductPricesForm.tsx): which fields are
// editable, the inline validation, the patch of touched fields, the conflict
// check against a fresh GET, the diff summary, the 400 mapping and the save.
// Never imported by a tenant page (guard: scripts/tests/catalogue-prices-admin-ui.test.ts).
//
// Save = "omitted is unchanged": PUT /api/admin/product-catalogue accepts a
// PARTIAL `{ catalogue }` and merges it into the stored row server side, so
// only the touched fields are sent (never engineOverride, never an untouched
// price). Right before the PUT the catalogue is re-read; if any price field
// differs from what the form loaded, nothing is sent (conflict line).
//
// Annual: the catalogue stores annual = 10 × monthly (two months free). The
// annual fields are derived and read-only: a touched monthly also sends its
// annual (10 ×, rounded to the cent).

import {
  CATALOGUE_CURRENCIES,
  PRODUCT_PRICE_FIELDS,
  isNullByDesign,
  parseProductCatalogue,
  type CatalogueCurrency,
  type ProductCatalogue,
  type ProductPriceRow,
} from "@/lib/product-catalogue";
import { PRODUCTS, type Product, type ProductNames } from "@/lib/product-values";

import { putJson } from "./engine-ui";

export type EditableField = "monthly" | "addonMonthly" | "minutes" | "overagePerMin";
export const EDITABLE_FIELDS: readonly EditableField[] = ["monthly", "addonMonthly", "minutes", "overagePerMin"];

/** "<product>.<currency>.<field>" */
export type FieldKey = `${Product}.${CatalogueCurrency}.${EditableField}`;
export const fieldKey = (p: Product, c: CatalogueCurrency, f: EditableField): FieldKey => `${p}.${c}.${f}`;

/**
 * Each catalogue product's label, from the entries' names (their one key each,
 * DashboardNav.<entry>, read in French by the server: lib/product-names.ts).
 */
export function productLabels(names: ProductNames): Record<Product, string> {
  return {
    reception: names.reception,
    reception_multi: `${names.reception} multi-sites`,
    sales: names.sales,
    connect: names.connect,
  };
}

export const FIELD_LABEL: Record<keyof ProductPriceRow, string> = {
  monthly: "Prix mensuel",
  annual: "Prix annuel",
  addonMonthly: "Option, mensuel",
  addonAnnual: "Option, annuel",
  minutes: "Minutes incluses",
  overagePerMin: "Dépassement / min",
};

export const NOT_SOLD_AS_ADDON = "Non vendu en option";

/**
 * The line shown before saving. VERIFIED against the code (2026-11-22): the
 * catalogue's minutes and overage are read LIVE, on every request, for the
 * accounts that already have users.products set (billing-stats
 * usageByProduct, the 80 % / 100 % usage warning e-mails of the billing
 * cron); its prices are read by no payment (HYP checkout uses the "Tarifs"
 * plan grid), only published on GET /api/public/plan-pricing `products`.
 * So "existing customers are not affected" would be FALSE for minutes and
 * overage.
 */
export const CONFIRM_LINE =
  "Les comptes déjà sur la nouvelle offre voient ces minutes incluses et ce tarif de dépassement dès l'enregistrement (facturation, alertes à 80 % et 100 %). Les prix ne sont encore utilisés par aucun paiement : le paiement suit la grille « Tarifs ».";

export const CONFLICT_LINE =
  "Le catalogue a été modifié ailleurs depuis le chargement. Rien n'a été enregistré : rechargez-le, vérifiez, puis enregistrez de nouveau.";

/** false only for the reception_multi add-on price (never sold as an add-on). */
export function isEditable(p: Product, f: EditableField): boolean {
  return !isNullByDesign(p, f);
}

/** The annual field derived from a monthly one (null for minutes / overage). */
export function annualOf(f: EditableField): "annual" | "addonAnnual" | null {
  return f === "monthly" ? "annual" : f === "addonMonthly" ? "addonAnnual" : null;
}

/** Annual = 10 × monthly, rounded to the cent. */
export const deriveAnnual = (monthly: number): number => Math.round(monthly * 1000) / 100;

// ── Validation ─────────────────────────────────────────────────────────────

export type Parsed = { ok: true; value: number } | { ok: false; error: string };

const INTEGER = /^\d+$/;
const DECIMAL = /^\d+(?:[.,]\d+)?$/;

/** Minutes: an integer ≥ 0. Prices and overage: a number ≥ 0, decimals allowed ("," or "."). */
export function parseFieldInput(f: EditableField, raw: string): Parsed {
  const s = raw.trim();
  if (s === "") return { ok: false, error: "Valeur requise." };
  if (f === "minutes") {
    if (!INTEGER.test(s)) return { ok: false, error: "Nombre entier ≥ 0 attendu." };
    return { ok: true, value: Number(s) };
  }
  if (!DECIMAL.test(s)) return { ok: false, error: "Nombre ≥ 0 attendu (décimales acceptées)." };
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: "Nombre ≥ 0 attendu (décimales acceptées)." };
}

/** Drafts: the raw text of the fields the admin typed in, and only those. */
export type Drafts = Partial<Record<FieldKey, string>>;

const splitKey = (k: FieldKey) => k.split(".") as [Product, CatalogueCurrency, EditableField];

/** The inline error per draft field (a non-editable field is always an error). */
export function draftErrors(drafts: Drafts): Partial<Record<FieldKey, string>> {
  const out: Partial<Record<FieldKey, string>> = {};
  for (const [k, raw] of Object.entries(drafts) as [FieldKey, string][]) {
    const [p, , f] = splitKey(k);
    if (!isEditable(p, f)) {
      out[k] = NOT_SOLD_AS_ADDON;
      continue;
    }
    const r = parseFieldInput(f, raw);
    if (!r.ok) out[k] = r.error;
  }
  return out;
}

// ── Patch (touched fields only) ───────────────────────────────────────────

export type PricesPatch = Partial<Record<Product, Partial<Record<CatalogueCurrency, Partial<ProductPriceRow>>>>>;

/**
 * The touched fields whose value differs from the loaded catalogue, plus
 * their derived annual. A draft equal to the loaded value, an invalid one or
 * a non-editable one is left out (never sent).
 */
export function pricesPatch(loaded: ProductCatalogue, drafts: Drafts): PricesPatch {
  const patch: PricesPatch = {};
  for (const [k, raw] of Object.entries(drafts) as [FieldKey, string][]) {
    const [p, c, f] = splitKey(k);
    if (!isEditable(p, f)) continue;
    const r = parseFieldInput(f, raw);
    if (!r.ok || r.value === loaded[p][c][f]) continue;
    const row = ((patch[p] ??= {})[c] ??= {});
    row[f] = r.value;
    const a = annualOf(f);
    if (a) row[a] = deriveAnnual(r.value);
  }
  return patch;
}

/** The PUT body: `{ catalogue: <touched fields> }`. Never an engineOverride. */
export function pricesPutBody(patch: PricesPatch): { catalogue: PricesPatch } {
  return { catalogue: patch };
}

export const patchIsEmpty = (patch: PricesPatch) => Object.keys(patch).length === 0;

/** The catalogue after the patch (what the server should hold after the PUT). */
export function applyPatch(cat: ProductCatalogue, patch: PricesPatch): ProductCatalogue {
  const next = structuredClone(cat);
  for (const p of Object.keys(patch) as Product[])
    for (const c of Object.keys(patch[p]!) as CatalogueCurrency[]) Object.assign(next[p][c], patch[p]![c]);
  return next;
}

// ── Diff summary ───────────────────────────────────────────────────────────

export type DiffLine = { path: string; label: string; from: number | null; to: number | null };

/** One line per field the patch changes (derived annual included), in catalogue order. */
export function diffSummary(loaded: ProductCatalogue, patch: PricesPatch, labels: Record<Product, string>): DiffLine[] {
  const out: DiffLine[] = [];
  for (const p of PRODUCTS)
    for (const c of CATALOGUE_CURRENCIES)
      for (const f of PRODUCT_PRICE_FIELDS) {
        const to = patch[p]?.[c]?.[f];
        if (to === undefined || to === loaded[p][c][f]) continue;
        out.push({ path: `${p}.${c}.${f}`, label: `${labels[p]} · ${c} · ${FIELD_LABEL[f]}`, from: loaded[p][c][f], to });
      }
  return out;
}

export function formatAmount(n: number | null): string {
  return n === null ? "—" : String(n).replace(".", ",");
}

// ── Conflict ───────────────────────────────────────────────────────────────

/** Every price field ("p.c.f") whose server value differs from the loaded one. */
export function catalogueConflicts(loaded: ProductCatalogue, latest: ProductCatalogue): string[] {
  const out: string[] = [];
  for (const p of PRODUCTS)
    for (const c of CATALOGUE_CURRENCIES)
      for (const f of PRODUCT_PRICE_FIELDS) if (loaded[p][c][f] !== latest[p][c][f]) out.push(`${p}.${c}.${f}`);
  return out;
}

// ── 400 → inline ───────────────────────────────────────────────────────────

/**
 * `catalogue.<p>.<c>.<f>` → that field's input (annual → its monthly input,
 * since annual is derived from it); anything else → the form line.
 */
export function pricesFieldErrors(fields: readonly string[]): { byField: Partial<Record<FieldKey, string>>; other: string[] } {
  const byField: Partial<Record<FieldKey, string>> = {};
  const other: string[] = [];
  for (const path of fields) {
    const m = /^catalogue\.([a-z_]+)\.(EUR|ILS)\.([A-Za-z]+)$/.exec(path);
    const p = m?.[1] as Product | undefined;
    const c = m?.[2] as CatalogueCurrency | undefined;
    const raw = m?.[3];
    const f: EditableField | undefined =
      raw === "annual" ? "monthly" : raw === "addonAnnual" ? "addonMonthly" : (EDITABLE_FIELDS as readonly string[]).includes(raw ?? "") ? (raw as EditableField) : undefined;
    if (!p || !c || !f || !(PRODUCTS as readonly string[]).includes(p) || !isEditable(p, f)) {
      other.push(path);
      continue;
    }
    byField[fieldKey(p, c, f)] = "Valeur refusée par le serveur.";
  }
  return { byField, other };
}

// ── Save (fetch injected: tests drive it with a fake) ──────────────────────

export const CATALOGUE_URL = "/api/admin/product-catalogue";

export type PricesSaveResult =
  | { ok: true; catalogue: ProductCatalogue }
  | { ok: false; kind: "conflict"; latest: ProductCatalogue; paths: string[] }
  | { ok: false; kind: "fields"; byField: Partial<Record<FieldKey, string>>; other: string[] }
  | { ok: false; kind: "error"; message: string };

/** GET the catalogue in force; null on any failure or an invalid shape. */
export async function fetchCatalogue(fetchFn: typeof fetch): Promise<ProductCatalogue | null> {
  try {
    const r = await fetchFn(CATALOGUE_URL, { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as { catalogue?: unknown } | null;
    return parseProductCatalogue(j?.catalogue);
  } catch {
    return null;
  }
}

/**
 * Re-reads the catalogue; any price field changed since `loaded` → conflict,
 * nothing sent. Else PUT the touched fields only.
 */
export async function savePrices(fetchFn: typeof fetch, loaded: ProductCatalogue, patch: PricesPatch): Promise<PricesSaveResult> {
  const latest = await fetchCatalogue(fetchFn);
  if (!latest) return { ok: false, kind: "error", message: "Le catalogue n'a pas pu être relu avant l'enregistrement." };
  const paths = catalogueConflicts(loaded, latest);
  if (paths.length) return { ok: false, kind: "conflict", latest, paths };
  const r = await putJson(fetchFn, CATALOGUE_URL, pricesPutBody(patch));
  if (!r.ok) {
    if (r.kind === "fields") return { ok: false, kind: "fields", ...pricesFieldErrors(r.fields) };
    return { ok: false, kind: "error", message: r.kind === "not_found" ? "Catalogue introuvable." : r.message };
  }
  const cat = parseProductCatalogue((r.json as { catalogue?: unknown } | null)?.catalogue);
  return cat ? { ok: true, catalogue: cat } : { ok: false, kind: "error", message: "Réponse inattendue du serveur." };
}
