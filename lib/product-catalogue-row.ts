// The STORED product catalogue row (app_settings "product_catalogue_v1") with
// the E2 engine overrides. ADMIN / SERVER side: it names engines, so the
// public landing (lib/public-plan-pricing.ts → lib/product-catalogue.ts) must
// NOT import it — lib/product-catalogue.ts stays prices only and unchanged.
//
// ADDITIVE shape: a product may carry `engineOverride` ({ engine, model },
// lib/engine-override.ts) next to its EUR / ILS rows:
//   { "reception": { "EUR": {…}, "ILS": {…}, "engineOverride": {…} }, … }
// Absent key = no override. A row with no override anywhere is stored as
// exactly JSON.stringify(prices): the bytes stored before E2.
// Pure, no I/O (storage: lib/products.ts).

import {
  engineOverrideProblems,
  hasAnyEngineOverride,
  noEngineOverrides,
  parseEngineOverride,
  type EngineOverrides,
} from "./engine-override";
import { catalogueWrite, parseProductCatalogue, type ProductCatalogue } from "./product-catalogue";
import { PRODUCTS, type Product } from "./product-values";

export const ENGINE_OVERRIDE_KEY = "engineOverride";

export type CatalogueRow = { catalogue: ProductCatalogue; engineOverrides: EngineOverrides };

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * STRICT parse of the whole row: the prices through parseProductCatalogue
 * (unchanged), plus per product an OPTIONAL `engineOverride` that must pass
 * parseEngineOverride — a malformed one fails the whole row, like any other
 * bad field (the caller serves the defaults and alerts).
 */
export function parseCatalogueRow(x: unknown): CatalogueRow | null {
  if (!isPlainObject(x)) return null;
  const prices: Record<string, unknown> = {};
  const overrides = noEngineOverrides();
  for (const [p, byCur] of Object.entries(x)) {
    if (isPlainObject(byCur) && Object.prototype.hasOwnProperty.call(byCur, ENGINE_OVERRIDE_KEY)) {
      if (!(PRODUCTS as readonly string[]).includes(p)) return null;
      const { [ENGINE_OVERRIDE_KEY]: raw, ...rest } = byCur;
      const o = parseEngineOverride(raw);
      if (!o) return null;
      overrides[p as Product] = o;
      prices[p] = rest;
    } else {
      prices[p] = byCur;
    }
  }
  const catalogue = parseProductCatalogue(prices);
  return catalogue ? { catalogue, engineOverrides: overrides } : null;
}

/**
 * The row's JSON. No override anywhere → exactly JSON.stringify(cat) (the
 * pre-E2 bytes); else `engineOverride` follows EUR / ILS on the products that
 * have one.
 */
export function serializeCatalogueRow(cat: ProductCatalogue, overrides: EngineOverrides = noEngineOverrides()): string {
  if (!hasAnyEngineOverride(overrides)) return JSON.stringify(cat);
  const row: Record<string, unknown> = {};
  for (const p of Object.keys(cat) as Product[]) {
    const o = overrides[p];
    row[p] = o ? { ...cat[p], [ENGINE_OVERRIDE_KEY]: o } : cat[p];
  }
  return JSON.stringify(row);
}

export type CatalogueRowWrite =
  | { ok: true; value: ProductCatalogue; engineOverrides: EngineOverrides; changed: boolean }
  | { ok: false; error: "invalid_catalogue"; fields: string[] };

/**
 * The admin write, from the RAW body `{ catalogue: <partial> }`. Prices: the
 * existing catalogueWrite rules, unchanged. E2: `catalogue.<product>.engineOverride`
 *   - omitted        → the stored override is kept;
 *   - null           → cleared;
 *   - { engine, model } → strict shape AND honoured for that product
 *     (lib/engine-resolve.ts honouredOptions, VP (ii)); a not-honoured
 *     engine / model is refused, naming `catalogue.<p>.engineOverride.<engine|model>`.
 * Any refusal → nothing is written (every offending path is named).
 */
export function catalogueRowWrite(stored: CatalogueRow, body: unknown): CatalogueRowWrite {
  const nextOverrides = structuredClone(stored.engineOverrides);
  const bad: string[] = [];
  let priceBody = body;
  if (isPlainObject(body) && isPlainObject(body.catalogue)) {
    const patch: Record<string, unknown> = {};
    for (const [p, byCur] of Object.entries(body.catalogue)) {
      if (!isPlainObject(byCur) || !Object.prototype.hasOwnProperty.call(byCur, ENGINE_OVERRIDE_KEY)) {
        patch[p] = byCur;
        continue;
      }
      const { [ENGINE_OVERRIDE_KEY]: raw, ...rest } = byCur;
      patch[p] = rest;
      if (!(PRODUCTS as readonly string[]).includes(p)) continue; // catalogueWrite names the unknown product
      const product = p as Product;
      if (raw === null) {
        nextOverrides[product] = null;
        continue;
      }
      const o = parseEngineOverride(raw);
      if (!o) {
        bad.push(`catalogue.${p}.${ENGINE_OVERRIDE_KEY}`);
        continue;
      }
      const problems = engineOverrideProblems(product, o);
      if (problems.length) {
        bad.push(...problems.map((k) => `catalogue.${p}.${ENGINE_OVERRIDE_KEY}.${k}`));
        continue;
      }
      nextOverrides[product] = o;
    }
    priceBody = { ...body, catalogue: patch };
  }
  const w = catalogueWrite(stored.catalogue, priceBody);
  if (!w.ok) return { ok: false, error: w.error, fields: [...w.fields, ...bad] };
  if (bad.length) return { ok: false, error: "invalid_catalogue", fields: bad };
  return {
    ok: true,
    value: w.value,
    engineOverrides: nextOverrides,
    changed: serializeCatalogueRow(w.value, nextOverrides) !== serializeCatalogueRow(stored.catalogue, stored.engineOverrides),
  };
}
