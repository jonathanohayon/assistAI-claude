import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { type CostRates } from "@/lib/finance/rates";
import { getCostRates, setCostRates } from "@/lib/finance/rates-storage";
import { logEvent } from "@/lib/logger";

// GET/PUT /api/admin/cost-rates
// Admin-only. Lit/écrit la grille tarifaire Finance (rate card).

async function requireAdmin(): Promise<
  | { ok: true; me: { role: string | null; email: string | null; id: string } }
  | { ok: false; res: NextResponse }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      ok: false,
      res: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  const [me] = await db
    .select({ role: users.role, email: users.email })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (me?.role !== "admin") {
    return {
      ok: false,
      res: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return {
    ok: true,
    me: { role: me.role, email: me.email, id: session.user.id },
  };
}

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  return NextResponse.json({ rates: await getCostRates() });
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const { me } = gate;

  let body: { rates?: unknown } & Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

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
