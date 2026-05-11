import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { syncTenantCalendarToSheet } from "@/lib/sync-tenant";

// POST /api/dashboard/sync-now
// Déclenche immédiatement un sync Calendar → Sheet Clients pour le user
// loggué (session auth, pas INTERNAL_SECRET — c'est le bouton "Sync now"
// du dashboard). Rapide retour. Compagnon du cron Railway 5min.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [me] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!me) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const startedAt = Date.now();
  const r = await syncTenantCalendarToSheet(me.id);
  const elapsedMs = Date.now() - startedAt;

  // logEvent metadata expects Record<string, unknown> — spread our typed
  // result into a plain object.
  const metadata = { ...r } as Record<string, unknown>;
  if (r.ok) {
    await logEvent({
      source: "sync",
      event: "manual_sync",
      message: `Sync manuel ${me.email} : +${r.inserted}, ↻${r.updated} sur ${r.scanned} (${elapsedMs}ms)`,
      userId: me.id,
      metadata,
    });
  } else {
    await logEvent({
      source: "sync",
      event: "manual_sync_failed",
      message: `Sync manuel ${me.email} échoué : ${r.reason ?? "unknown"}`,
      level: "warn",
      userId: me.id,
      metadata,
    });
  }

  return NextResponse.json({ ...r, elapsedMs });
}
