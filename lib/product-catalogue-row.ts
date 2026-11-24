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
import {
  CONNECTOR_LIMITS_KEY,
  connectorLimitsWrite,
  defaultConnectorLimits,
  parseConnectorLimits,
  type ConnectorLimits,
} from "./connectors/limits";
import {
  CONNECTOR_EXTRA_MONTHLY_KEY,
  connectorExtraMonthlyWrite,
  defaultConnectorExtraMonthly,
  parseConnectorExtraMonthly,
  type ConnectorExtraMonthly,
} from "./connectors/price";
import { catalogueWrite, parseProductCatalogue, type ProductCatalogue } from "./product-catalogue";
import { PRODUCTS, type Product } from "./product-values";

export const ENGINE_OVERRIDE_KEY = "engineOverride";

// B1 (additive): the row may also carry a TOP-LEVEL `connectorLimits`
// ({ trial, paid }, lib/connectors/limits.ts). Absent = the defaults, and the
// row's bytes are exactly what they were before B1.
// C1b (additive): likewise a TOP-LEVEL `connectorExtraMonthly` ({ EUR, ILS },
// lib/connectors/price.ts), the monthly price of one extra connector.
export type CatalogueRow = {
  catalogue: ProductCatalogue;
  engineOverrides: EngineOverrides;
  /** Stored connector limits; undefined = not stored (DEFAULT_CONNECTOR_LIMITS apply). */
  connectorLimits?: ConnectorLimits;
  /** C1b: stored extra-connector price; undefined = not stored (DEFAULT_CONNECTOR_EXTRA_MONTHLY apply). */
  connectorExtraMonthly?: ConnectorExtraMonthly;
};

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
  let connectorLimits: ConnectorLimits | undefined;
  let connectorExtraMonthly: ConnectorExtraMonthly | undefined;
  for (const [p, byCur] of Object.entries(x)) {
    if (p === CONNECTOR_LIMITS_KEY) {
      // A malformed (or > HARD_MAX_CONNECTORS) value fails the whole row.
      const l = parseConnectorLimits(byCur);
      if (!l) return null;
      connectorLimits = l;
      continue;
    }
    if (p === CONNECTOR_EXTRA_MONTHLY_KEY) {
      // A malformed value fails the whole row.
      const e = parseConnectorExtraMonthly(byCur);
      if (!e) return null;
      connectorExtraMonthly = e;
      continue;
    }
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
  if (!catalogue) return null;
  return {
    catalogue,
    engineOverrides: overrides,
    ...(connectorLimits ? { connectorLimits } : {}),
    ...(connectorExtraMonthly ? { connectorExtraMonthly } : {}),
  };
}

/**
 * The row's JSON. No override anywhere → exactly JSON.stringify(cat) (the
 * pre-E2 bytes); else `engineOverride` follows EUR / ILS on the products that
 * have one.
 */
export function serializeCatalogueRow(
  cat: ProductCatalogue,
  overrides: EngineOverrides = noEngineOverrides(),
  connectorLimits?: ConnectorLimits,
  connectorExtraMonthly?: ConnectorExtraMonthly,
): string {
  if (!hasAnyEngineOverride(overrides) && !connectorLimits && !connectorExtraMonthly) return JSON.stringify(cat);
  const row: Record<string, unknown> = {};
  for (const p of Object.keys(cat) as Product[]) {
    const o = overrides[p];
    row[p] = o ? { ...cat[p], [ENGINE_OVERRIDE_KEY]: o } : cat[p];
  }
  // B1: connector limits, when stored, follow the products.
  if (connectorLimits) row[CONNECTOR_LIMITS_KEY] = { trial: connectorLimits.trial, paid: connectorLimits.paid };
  // C1b: the extra-connector price, when stored, follows them.
  if (connectorExtraMonthly) row[CONNECTOR_EXTRA_MONTHLY_KEY] = { EUR: connectorExtraMonthly.EUR, ILS: connectorExtraMonthly.ILS };
  return JSON.stringify(row);
}

export type CatalogueRowWrite =
  | {
      ok: true;
      value: ProductCatalogue;
      engineOverrides: EngineOverrides;
      /** The limits to store: the stored ones when omitted (undefined = still not stored). */
      connectorLimits?: ConnectorLimits;
      /** The extra-connector price to store: the stored one when omitted (undefined = still not stored). */
      connectorExtraMonthly?: ConnectorExtraMonthly;
      changed: boolean;
    }
  | { ok: false; error: "invalid_catalogue"; fields: string[] };

/**
 * The admin write, from the RAW body `{ catalogue: <partial> }`. Prices: the
 * existing catalogueWrite rules, unchanged. E2: `catalogue.<product>.engineOverride`
 *   - omitted        → the stored override is kept;
 *   - null           → cleared;
 *   - { engine, model } → strict shape AND honoured for that product
 *     (lib/engine-resolve.ts honouredOptions, VP (ii)); a not-honoured
 *     engine / model is refused, naming `catalogue.<p>.engineOverride.<engine|model>`.
 * B1: top-level `connectorLimits: { trial?, paid? }` (lib/connectors/limits.ts)
 *   - omitted        → the stored limits are kept (or stay unstored);
 *   - present        → each present field an integer 0..HARD_MAX_CONNECTORS
 *     (> 10 refused, never clamped), omitted fields keep their value, an
 *     unknown key is refused, naming `connectorLimits.<field>`.
 * C1b: top-level `connectorExtraMonthly: { EUR?, ILS? }` (lib/connectors/price.ts)
 *   - omitted        → the stored price is kept (or stays unstored);
 *   - present        → each present currency a finite number >= 0, omitted
 *     currencies keep their value, an unknown key is refused, naming
 *     `connectorExtraMonthly.<currency>`.
 * Any refusal → nothing is written (every offending path is named).
 */
export function catalogueRowWrite(stored: CatalogueRow, body: unknown): CatalogueRowWrite {
  const nextOverrides = structuredClone(stored.engineOverrides);
  const bad: string[] = [];
  let priceBody = body;
  let nextLimits = stored.connectorLimits ? { ...stored.connectorLimits } : undefined;
  if (isPlainObject(body) && Object.prototype.hasOwnProperty.call(body, CONNECTOR_LIMITS_KEY)) {
    const { [CONNECTOR_LIMITS_KEY]: rawLimits, ...restBody } = body;
    const lw = connectorLimitsWrite(stored.connectorLimits ?? defaultConnectorLimits(), rawLimits);
    if (lw.ok) nextLimits = lw.value;
    else bad.push(...lw.fields);
    body = restBody;
    priceBody = restBody;
  }
  let nextExtra = stored.connectorExtraMonthly ? { ...stored.connectorExtraMonthly } : undefined;
  if (isPlainObject(body) && Object.prototype.hasOwnProperty.call(body, CONNECTOR_EXTRA_MONTHLY_KEY)) {
    const { [CONNECTOR_EXTRA_MONTHLY_KEY]: rawExtra, ...restBody } = body;
    const ew = connectorExtraMonthlyWrite(stored.connectorExtraMonthly ?? defaultConnectorExtraMonthly(), rawExtra);
    if (ew.ok) nextExtra = ew.value;
    else bad.push(...ew.fields);
    body = restBody;
    priceBody = restBody;
  }
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
    ...(nextLimits ? { connectorLimits: nextLimits } : {}),
    ...(nextExtra ? { connectorExtraMonthly: nextExtra } : {}),
    changed:
      serializeCatalogueRow(w.value, nextOverrides, nextLimits, nextExtra) !==
      serializeCatalogueRow(stored.catalogue, stored.engineOverrides, stored.connectorLimits, stored.connectorExtraMonthly),
  };
}
