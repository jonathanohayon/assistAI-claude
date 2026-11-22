import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { logEvent } from "@/lib/logger";
import { catalogueWrite } from "@/lib/product-catalogue";
import { getProductCatalogue, setProductCatalogue } from "@/lib/products";

// /api/admin/product-catalogue — ADMIN ONLY. The product catalogue
// (app_settings "product_catalogue_v1", lib/product-catalogue.ts): base and
// add-on prices, included minutes and overage, per product and currency.
// No admin UI yet (FE later); the public numbers are served by
// GET /api/public/plan-pricing under `products`.

// GET — the catalogue in force (the stored row, else the defaults).
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  return NextResponse.json({ catalogue: await getProductCatalogue() });
}

// PUT — body `{ catalogue: <partial> }`. Only the fields present are written;
// everything omitted keeps its stored value (an empty body changes nothing).
// Any unknown key or invalid amount → 400 naming every offending path, and
// nothing is written.
export async function PUT(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => ({}))) as unknown;
  const stored = await getProductCatalogue();
  const w = catalogueWrite(stored, body);
  if (!w.ok) return NextResponse.json({ error: w.error, fields: w.fields }, { status: 400 });
  if (w.changed) {
    await setProductCatalogue(w.value);
    await logEvent({
      source: "web",
      event: "admin_settings_updated",
      message: `Admin ${guard.admin.id} edited product_catalogue`,
      userId: guard.admin.id,
      metadata: { keys: ["product_catalogue"] },
    });
  }
  return NextResponse.json({ ok: true, catalogue: w.value });
}
