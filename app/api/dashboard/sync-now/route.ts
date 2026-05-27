import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolveScopeUserId } from "@/lib/admin-impersonate";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { syncTenantCalendarToSheet } from "@/lib/sync-tenant";

// POST /api/dashboard/sync-now[?asUserId=<uuid>]
// Déclenche immédiatement un sync Calendar → Sheet Clients pour le user
// loggué (ou pour le tenant cible si admin avec asUserId). Compagnon du
// cron Railway 5min.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const scope = await resolveScopeUserId({
    sessionUserId: session.user.id,
    asUserId: req.nextUrl.searchParams.get("asUserId"),
  });
  if ("forbidden" in scope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [target] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, scope.userId))
    .limit(1);
  if (!target) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const startedAt = Date.now();
  const r = await syncTenantCalendarToSheet(target.id);
  const elapsedMs = Date.now() - startedAt;

  const metadata = { ...r, triggeredBy: session.user.id } as Record<string, unknown>;
  if (r.ok) {
    await logEvent({
      source: "sync",
      event: "manual_sync",
      message: `Sync manuel ${target.email} : +${r.inserted}, ↻${r.updated} sur ${r.scanned} (${elapsedMs}ms)`,
      userId: target.id,
      metadata,
    });
  } else {
    await logEvent({
      source: "sync",
      event: "manual_sync_failed",
      message: `Sync manuel ${target.email} échoué : ${r.reason ?? "unknown"}`,
      level: "warn",
      userId: target.id,
      metadata,
    });
  }

  return NextResponse.json({ ...r, elapsedMs });
}
