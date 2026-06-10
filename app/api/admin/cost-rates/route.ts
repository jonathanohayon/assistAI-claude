import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { type CostRates } from "@/lib/finance/rates";
import { getCostRates, setCostRates } from "@/lib/finance/rates-storage";
import { logEvent } from "@/lib/logger";

// GET/PUT /api/admin/cost-rates
// Admin-only. Lit/écrit la grille tarifaire Finance (rate card).

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

  await setCostRates(body.rates ?? body);

  await logEvent({
    source: "web",
    event: "admin_cost_rates_updated",
    message: `Admin ${me.email} a mis à jour la grille tarifaire`,
    userId: me.id,
  });

  const rates: CostRates = await getCostRates();
  return NextResponse.json({ ok: true, rates });
}
