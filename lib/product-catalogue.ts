// The product catalogue (prices, included minutes, overage) as data: types,
// the defaults (the VP grid, 2026-11) and a STRICT parser. Client-safe: no
// lib/db here (the public pricing parser and the future admin form import
// it). Storage + accountProducts live in lib/products.ts (server).
//
// Per product and per currency, six amounts, each a number or null:
//   monthly / annual            price of the product as the BASE;
//   addonMonthly / addonAnnual  price when added to another base;
//   minutes                     minutes included per month;
//   overagePerMin               price of a minute beyond them.
// Every amount is a number, except the reception_multi add-on prices, which
// are null BY DESIGN (reception_multi is never sold as an add-on).
// Annual = 10 × monthly (two months free).

import { PRODUCTS, type Product } from "./product-values";

export type CatalogueCurrency = "EUR" | "ILS";
export const CATALOGUE_CURRENCIES: readonly CatalogueCurrency[] = ["EUR", "ILS"] as const;

export type ProductPriceRow = {
  monthly: number;
  annual: number;
  /** null only for reception_multi (never sold as an add-on). */
  addonMonthly: number | null;
  addonAnnual: number | null;
  minutes: number;
  overagePerMin: number;
};
export const PRODUCT_PRICE_FIELDS: readonly (keyof ProductPriceRow)[] = [
  "monthly",
  "annual",
  "addonMonthly",
  "addonAnnual",
  "minutes",
  "overagePerMin",
] as const;

export type ProductCatalogue = Record<Product, Record<CatalogueCurrency, ProductPriceRow>>;

function row(monthly: number, addonMonthly: number | null, minutes: number, overagePerMin: number): ProductPriceRow {
  return { monthly, annual: monthly * 10, addonMonthly, addonAnnual: addonMonthly === null ? null : addonMonthly * 10, minutes, overagePerMin };
}

// The VP grid (2026-11): base / add-on / minutes / overage per currency.
// The sales ILS minutes and overage differ from EUR ON PURPOSE.
export const DEFAULT_PRODUCT_CATALOGUE: ProductCatalogue = {
  reception: { EUR: row(89, 69, 200, 0.39), ILS: row(349, 269, 200, 1.5) },
  reception_multi: { EUR: row(169, null, 450, 0.39), ILS: row(649, null, 450, 1.5) },
  sales: { EUR: row(149, 99, 400, 0.39), ILS: row(549, 399, 250, 1.9) },
  connect: { EUR: row(49, 39, 100, 0.39), ILS: row(199, 149, 100, 1.5) },
};

/** True for the only fields that are null by design. */
export function isNullByDesign(product: Product, field: keyof ProductPriceRow): boolean {
  return product === "reception_multi" && (field === "addonMonthly" || field === "addonAnnual");
}

/** A fresh deep copy of the defaults (callers may mutate it). */
export function defaultProductCatalogue(): ProductCatalogue {
  return structuredClone(DEFAULT_PRODUCT_CATALOGUE);
}

const isNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
/** A field's value is valid: a number ≥ 0, or null exactly where null is by design. */
const isFieldValue = (p: Product, f: keyof ProductPriceRow, v: unknown) => (isNullByDesign(p, f) ? v === null : isNumber(v));
const isPlainObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const sameKeys = (o: Record<string, unknown>, keys: readonly string[]) => {
  const k = Object.keys(o);
  return k.length === keys.length && keys.every((x) => Object.prototype.hasOwnProperty.call(o, x));
};

function parseRow(p: Product, x: unknown): ProductPriceRow | null {
  if (!isPlainObject(x) || !sameKeys(x, PRODUCT_PRICE_FIELDS)) return null;
  const out: Record<string, number | null> = {};
  for (const f of PRODUCT_PRICE_FIELDS) {
    if (!isFieldValue(p, f, x[f])) return null;
    out[f] = x[f] as number | null;
  }
  return out as ProductPriceRow;
}

/**
 * STRICT parse: exactly the four products, each with exactly EUR and ILS,
 * each with exactly the six fields, each a finite number ≥ 0 (null only,
 * and always, for the reception_multi add-on prices).
 * Anything else → null (no filling from the defaults: the caller decides).
 */
export function parseProductCatalogue(x: unknown): ProductCatalogue | null {
  if (!isPlainObject(x) || !sameKeys(x, PRODUCTS)) return null;
  const out = {} as ProductCatalogue;
  for (const p of PRODUCTS) {
    const byCur = x[p];
    if (!isPlainObject(byCur) || !sameKeys(byCur, CATALOGUE_CURRENCIES)) return null;
    const eur = parseRow(p, byCur.EUR);
    const ils = parseRow(p, byCur.ILS);
    if (!eur || !ils) return null;
    out[p] = { EUR: eur, ILS: ils };
  }
  return out;
}

/** Included monthly minutes of a product in a currency's grid. */
export function catalogueMinutes(cat: ProductCatalogue, product: Product, currency: CatalogueCurrency): number {
  return cat[product][currency].minutes;
}

/** Overage per minute of a product in a currency. */
export function catalogueOverage(cat: ProductCatalogue, product: Product, currency: CatalogueCurrency): number {
  return cat[product][currency].overagePerMin;
}

export type CatalogueWrite =
  | { ok: true; value: ProductCatalogue; changed: boolean }
  | { ok: false; error: "invalid_catalogue"; fields: string[] };

/**
 * The admin write, from the RAW parsed body: `{ catalogue: <partial> }`.
 * Only the products / currencies / fields PRESENT are written; everything
 * omitted keeps the stored value. A present field must be a number ≥ 0
 * (null only for the reception_multi add-on prices, which must stay null);
 * an unknown key or a bad value is refused with every offending path named,
 * and nothing is written.
 */
export function catalogueWrite(stored: ProductCatalogue, body: unknown): CatalogueWrite {
  const next = structuredClone(stored);
  const bad: string[] = [];
  if (!isPlainObject(body)) return { ok: false, error: "invalid_catalogue", fields: ["body"] };
  const extra = Object.keys(body).filter((k) => k !== "catalogue");
  bad.push(...extra);
  const patch = body.catalogue;
  if (patch === undefined) {
    return bad.length ? { ok: false, error: "invalid_catalogue", fields: bad } : { ok: true, value: next, changed: false };
  }
  if (!isPlainObject(patch)) return { ok: false, error: "invalid_catalogue", fields: [...bad, "catalogue"] };
  for (const [p, byCur] of Object.entries(patch)) {
    if (!(PRODUCTS as readonly string[]).includes(p)) {
      bad.push(`catalogue.${p}`);
      continue;
    }
    if (!isPlainObject(byCur)) {
      bad.push(`catalogue.${p}`);
      continue;
    }
    for (const [c, fields] of Object.entries(byCur)) {
      if (!(CATALOGUE_CURRENCIES as readonly string[]).includes(c) || !isPlainObject(fields)) {
        bad.push(`catalogue.${p}.${c}`);
        continue;
      }
      for (const [f, v] of Object.entries(fields)) {
        if (!(PRODUCT_PRICE_FIELDS as readonly string[]).includes(f) || !isFieldValue(p as Product, f as keyof ProductPriceRow, v)) {
          bad.push(`catalogue.${p}.${c}.${f}`);
          continue;
        }
        (next[p as Product][c as CatalogueCurrency] as Record<string, number | null>)[f] = v as number | null;
      }
    }
  }
  if (bad.length) return { ok: false, error: "invalid_catalogue", fields: bad };
  return { ok: true, value: next, changed: JSON.stringify(next) !== JSON.stringify(stored) };
}
