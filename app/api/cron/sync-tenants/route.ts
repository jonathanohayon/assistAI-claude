import { isNotNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { syncTenantCalendarToSheet } from "@/lib/sync-tenant";

// Cron endpoint : itère TOUS les tenants avec Google connecté et déclenche
// le sync Calendar → Sheet (Clients) pour chacun. Best-effort par tenant :
// si un tenant échoue, on log + on continue avec les suivants. Aucun
// échec local ne bloque les autres.
//
// Auth : INTERNAL_SECRET (gated). À hook sur un cron Railway externe
// (every 5min recommandé), OU appelable manuellement depuis le dashboard
// pour un sync immédiat.
//
// La règle « chaque tenant doit avoir la même fonctionnalité » est tenue
// par le fait que la query select TOUS les users avec googleRefreshToken
// non-null — pas de whitelist par email/role, tout salon configuré y a droit.

export async function GET(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;

  const startedAt = Date.now();
  const allTenants = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(isNotNull(users.googleRefreshToken));

  const results: Array<{
    userId: string;
    email: string;
    scanned: number;
    inserted: number;
    updated: number;
    skipped: number;
    errors: number;
    ok: boolean;
    reason?: string;
    durationMs: number;
  }> = [];

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  for (const t of allTenants) {
    const t0 = Date.now();
    try {
      const r = await syncTenantCalendarToSheet(t.id);
      const elapsedMs = Date.now() - t0;
      results.push({
        userId: t.id,
        email: t.email,
        scanned: r.scanned,
        inserted: r.inserted,
        updated: r.updated,
        skipped: r.skipped,
        errors: r.errors.length,
        ok: r.ok,
        reason: r.reason,
        durationMs: elapsedMs,
      });
      totalInserted += r.inserted;
      totalUpdated += r.updated;
      totalErrors += r.errors.length;
      if (r.ok && (r.inserted > 0 || r.updated > 0)) {
        await logEvent({
          source: "sync",
          event: "tenant_synced",
          message: `Sync ${t.email} : +${r.inserted} ajoutés, ↻${r.updated} màj sur ${r.scanned} events (${elapsedMs}ms)`,
          userId: t.id,
          metadata: { ...r } as Record<string, unknown>,
        });
      }
      if (r.errors.length > 0) {
        await logEvent({
          source: "sync",
          event: "tenant_sync_errors",
          message: `Sync ${t.email} : ${r.errors.length} erreur(s) — ${r.errors[0]?.slice(0, 100)}`,
          level: "warn",
          userId: t.id,
          metadata: { errors: r.errors, reason: r.reason },
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "sync failed";
      results.push({
        userId: t.id,
        email: t.email,
        scanned: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: 1,
        ok: false,
        reason: "exception",
        durationMs: Date.now() - t0,
      });
      totalErrors++;
      await logEvent({
        source: "sync",
        event: "tenant_sync_failed",
        message: `Sync ${t.email} crashed : ${msg.slice(0, 200)}`,
        level: "error",
        userId: t.id,
        metadata: { error: msg },
      });
    }
  }

  const elapsedMs = Date.now() - startedAt;
  return NextResponse.json({
    ok: true,
    tenantsTotal: allTenants.length,
    totalInserted,
    totalUpdated,
    totalErrors,
    elapsedMs,
    results,
  });
}
