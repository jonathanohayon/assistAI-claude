import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { getTileToggles, setTileToggles } from "@/lib/tile-toggles";

export const dynamic = "force-dynamic";

// Toggles des capacités agent par tuile CRM (calendar/customers/orders).
// Session-auth (+ impersonation admin via ?asUserId, comme les routes voisines).

export async function GET(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const toggles = await getTileToggles(r.userId);
  return NextResponse.json({ toggles });
}

export async function POST(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = await parseJsonBody<{
    calendar?: boolean;
    customers?: boolean;
    orders?: boolean;
  }>(req);
  if (!parsed.ok) return parsed.response;

  const patch: Partial<{ calendar: boolean; customers: boolean; orders: boolean }> = {};
  if (typeof parsed.data.calendar === "boolean") patch.calendar = parsed.data.calendar;
  if (typeof parsed.data.customers === "boolean") patch.customers = parsed.data.customers;
  if (typeof parsed.data.orders === "boolean") patch.orders = parsed.data.orders;

  const toggles = await setTileToggles(r.userId, patch);
  return NextResponse.json({ toggles });
}
