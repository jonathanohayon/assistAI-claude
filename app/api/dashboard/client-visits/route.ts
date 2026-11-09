import { sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { REGULAR_MIN_VISITS } from "@/lib/loyalty";

const LIMIT = 2000;

// GET /api/dashboard/client-visits[?asUserId=] — loyalty v1 for the Contacts
// view: one row per client phone with past visits, last and next visit.
// Tenant-scoped (admins via asUserId, like the other dashboard routes).
export async function GET(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await db.execute(sql`
    SELECT client_phone,
      (array_agg(client_name ORDER BY starts_at DESC) FILTER (WHERE client_name <> ''))[1] AS name,
      count(*) FILTER (WHERE starts_at <= now())::int AS visits,
      max(starts_at) FILTER (WHERE starts_at <= now()) AS last_visit_at,
      min(starts_at) FILTER (WHERE starts_at > now()) AS next_visit_at
    FROM client_visits
    WHERE user_id = ${r.userId} AND NOT cancelled
    GROUP BY client_phone
    ORDER BY visits DESC, last_visit_at DESC NULLS LAST
    LIMIT ${LIMIT}
  `);
  const list = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Array<
    Record<string, unknown>
  >;
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

  return NextResponse.json({
    regularMinVisits: REGULAR_MIN_VISITS,
    clients: list.map((c) => {
      const visits = Number(c.visits ?? 0);
      return {
        phone: String(c.client_phone),
        name: String(c.name ?? ""),
        visits,
        lastVisitAt: iso(c.last_visit_at),
        nextVisitAt: iso(c.next_visit_at),
        regular: visits >= REGULAR_MIN_VISITS,
      };
    }),
  });
}
