import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { costRatesWrite, type CostRates } from "@/lib/finance/rates";
import { getCostRates, setCostRates } from "@/lib/finance/rates-storage";
import { logEvent } from "@/lib/logger";

// GET/PUT /api/admin/cost-rates
// Admin-only. Lit/écrit la grille tarifaire Finance (rate card).
// GET adds `perMinuteUsd` (per engine/model, additive); the historic keys are
// unchanged. PUT: the historic keys behave exactly as before; perMinuteUsd
// omitted = unchanged, present = a partial patch, invalid → 400 + paths.

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  return NextResponse.json({ rates: await getCostRates() });
}

export async function PUT(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const me = guard.admin;

  const parsed = await parseJsonBody<{ rates?: unknown } & Record<string, unknown>>(
    req,
  );
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const w = costRatesWrite(await getCostRates(), body);
  if (!w.ok) return NextResponse.json({ error: w.error, fields: w.fields }, { status: 400 });
  await setCostRates(w.value);

  await logEvent({
    source: "web",
    event: "admin_cost_rates_updated",
    message: `Admin ${me.id} a mis à jour la grille tarifaire`,
    userId: me.id,
  });

  const rates: CostRates = await getCostRates();
  return NextResponse.json({ ok: true, rates });
}
