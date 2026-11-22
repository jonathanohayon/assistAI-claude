import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { notifyCounts } from "@/lib/product-notify";

export const dynamic = "force-dynamic";

// GET /api/admin/product-notify — ADMIN ONLY. How many accounts asked
// "Prévenez-moi" per product entry: { counts: { reception, sales, connect } }.
// Counts only: never an id, an email or a date.
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  return NextResponse.json({ counts: await notifyCounts() });
}
