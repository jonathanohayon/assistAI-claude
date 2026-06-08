import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { computeFinanceStats, type Granularity } from "@/lib/finance/cost";
import { getCostRates } from "@/lib/finance/rates-storage";

// GET /api/admin/finance-stats?granularity=day|month|year&from=ISO&to=ISO&userId=uuid
// Admin-only. Retourne les coûts estimés (USD) agrégés par bucket + par
// tenant + le revenu/marge. userId optionnel → scope un seul tenant
// (utilisé par la vue /admin/users/[id]).

const VALID_GRAN: Granularity[] = ["day", "month", "year"];

function defaultRange(g: Granularity): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  if (g === "day") from.setUTCDate(from.getUTCDate() - 30);
  else if (g === "month") from.setUTCMonth(from.getUTCMonth() - 12);
  else from.setUTCFullYear(from.getUTCFullYear() - 3);
  return { from, to };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [me] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const granParam = sp.get("granularity") ?? "month";
  const granularity: Granularity = VALID_GRAN.includes(granParam as Granularity)
    ? (granParam as Granularity)
    : "month";

  const def = defaultRange(granularity);
  const fromParam = sp.get("from");
  const toParam = sp.get("to");
  const from = fromParam && !Number.isNaN(Date.parse(fromParam))
    ? new Date(fromParam)
    : def.from;
  const to = toParam && !Number.isNaN(Date.parse(toParam))
    ? new Date(toParam)
    : def.to;

  const userId = sp.get("userId");

  const rates = await getCostRates();
  const stats = await computeFinanceStats({
    rates,
    from,
    to,
    granularity,
    userId,
  });

  return NextResponse.json(stats);
}
