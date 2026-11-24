import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { engineOptionCoverage, withOptionCosts } from "@/lib/engine-override";
import { honouredOptions } from "@/lib/engine-resolve";
import { getEngineLanguages } from "@/lib/engine-languages-storage";
import { getCostRates } from "@/lib/finance/rates-storage";
import { logEvent } from "@/lib/logger";
import { catalogueRowWrite } from "@/lib/product-catalogue-row";
import { PRODUCTS } from "@/lib/product-values";
import { getCatalogueRow, setProductCatalogue } from "@/lib/products";

// /api/admin/product-catalogue — ADMIN ONLY. The product catalogue
// (app_settings "product_catalogue_v1", lib/product-catalogue.ts): base and
// add-on prices, included minutes and overage, per product and currency.
// E2 (additive): the per-product engine override
// (lib/product-catalogue-row.ts). The public numbers are served by
// GET /api/public/plan-pricing under `products` (prices only, never the
// override); the worker never receives this row.

/**
 * Per product: what the worker honours + every option with its languages
 * (the form disables / warns) and its costPerMinUsd, from the SAME stored
 * rates and function as the tenant engine banner (lib/engine-override.ts
 * withOptionCosts → perMinuteUsdFor).
 */
async function engineOptions() {
  const [languages, rates] = await Promise.all([getEngineLanguages(), getCostRates()]);
  return Object.fromEntries(
    PRODUCTS.map((p) => [p, { honoured: honouredOptions(p), options: withOptionCosts(engineOptionCoverage(p, languages), rates) }]),
  );
}

// GET — the catalogue in force (the stored row, else the defaults), its
// engine overrides, and the engine options per product.
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const row = await getCatalogueRow();
  // B1: `connectorLimits` only when stored (absent = DEFAULT_CONNECTOR_LIMITS,
  // lib/connectors/limits.ts), so a row without limits answers the pre-B1 bytes.
  // C1b: `connectorExtraMonthly` likewise only when stored (lib/connectors/price.ts).
  return NextResponse.json({
    catalogue: row.catalogue,
    engineOverrides: row.engineOverrides,
    engineOptions: await engineOptions(),
    ...(row.connectorLimits ? { connectorLimits: row.connectorLimits } : {}),
    ...(row.connectorExtraMonthly ? { connectorExtraMonthly: row.connectorExtraMonthly } : {}),
  });
}

// PUT — body `{ catalogue: <partial> }`. Only the fields present are written;
// everything omitted keeps its stored value (an empty body changes nothing).
// `catalogue.<product>.engineOverride`: { engine, model } sets it (refused
// with 400 naming it when the worker doesn't honour it for that product),
// null clears it, omitted keeps it. B1: top-level `connectorLimits:
// { trial?, paid? }` (integers 0..10, > 10 refused), omitted keeps the
// stored limits; responses carry `connectorLimits` only once stored.
// C1b: top-level `connectorExtraMonthly: { EUR?, ILS? }` (numbers >= 0),
// omitted keeps the stored price; carried in responses only once stored. Any unknown key or invalid value → 400
// naming every offending path, and nothing is written.
export async function PUT(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => ({}))) as unknown;
  const stored = await getCatalogueRow();
  const w = catalogueRowWrite(stored, body);
  if (!w.ok) return NextResponse.json({ error: w.error, fields: w.fields }, { status: 400 });
  if (w.changed) {
    await setProductCatalogue(w.value, w.engineOverrides, w.connectorLimits, w.connectorExtraMonthly);
    await logEvent({
      source: "web",
      event: "admin_settings_updated",
      message: `Admin ${guard.admin.id} edited product_catalogue`,
      userId: guard.admin.id,
      metadata: { keys: ["product_catalogue"] },
    });
  }
  return NextResponse.json({
    ok: true,
    catalogue: w.value,
    engineOverrides: w.engineOverrides,
    ...(w.connectorLimits ? { connectorLimits: w.connectorLimits } : {}),
    ...(w.connectorExtraMonthly ? { connectorExtraMonthly: w.connectorExtraMonthly } : {}),
  });
}
