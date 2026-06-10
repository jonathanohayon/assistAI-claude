/**
 * Guards d'authentification centralisés pour les routes API (app/api/**).
 *
 * Trois niveaux d'accès existent dans l'app :
 *   1. Session utilisateur (cookie next-auth)        → requireSession()
 *   2. Session utilisateur avec rôle admin           → requireAdmin()
 *   3. Machine-to-machine (worker Railway, crons)    → requireInternalSecret()
 *
 * Chaque guard retourne un objet discriminé `{ ok: true, ... }` ou
 * `{ ok: false, response }` où `response` est la NextResponse d'erreur
 * prête à être retournée. Usage type dans une route :
 *
 *   const guard = await requireAdmin();
 *   if (!guard.ok) return guard.response;
 *   // guard.admin est typé et garanti non-null ici
 *
 * Convention de status codes (HTTP sémantique) :
 *   - 401 unauthorized : credentials absents ou invalides (pas de session,
 *     secret interne manquant/faux).
 *   - 403 forbidden    : authentifié mais droits insuffisants (non-admin
 *     sur une route admin, asUserId sans rôle admin).
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { resolveScopeUserId } from "@/lib/admin-impersonate";

type UserRow = typeof users.$inferSelect;

/** Session utilisateur requise. Retourne l'userId de la session. */
export async function requireSession(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true, userId: session.user.id };
}

/**
 * Session utilisateur AVEC rôle admin requise. Retourne la row complète de
 * l'admin (utile pour logEvent, email, etc.).
 */
export async function requireAdmin(): Promise<
  { ok: true; admin: UserRow } | { ok: false; response: NextResponse }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  const [me] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (me?.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, admin: me };
}

/**
 * Auth machine-to-machine via header `x-internal-secret` (worker Railway,
 * crons, scripts d'admin interne). Refuse aussi si INTERNAL_SECRET n'est
 * pas configuré côté serveur (fail-closed).
 */
export function requireInternalSecret(
  req: NextRequest,
): { ok: true } | { ok: false; response: NextResponse } {
  const expected = process.env.INTERNAL_SECRET;
  const provided = req.headers.get("x-internal-secret");
  if (!expected || provided !== expected) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true };
}

/**
 * Résout l'userId effectif pour une route dashboard, avec support de
 * l'impersonation admin : `?asUserId=<uuid>` permet à un admin de lire les
 * données d'un tenant (vue partagée /admin/users/[id] ↔ /dashboard).
 *
 * Retours possibles :
 *   - { userId }              → scope résolu, requête autorisée
 *   - { unauthorized: true }  → pas de session (la route doit répondre 401)
 *   - { forbidden: true }     → asUserId demandé par un non-admin (→ 403)
 */
export async function resolveTargetUserId(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return { unauthorized: true as const };
  const asUserId = req.nextUrl.searchParams.get("asUserId");
  const scope = await resolveScopeUserId({
    sessionUserId: session.user.id,
    asUserId,
  });
  if ("forbidden" in scope) return { forbidden: true as const };
  return { userId: scope.userId };
}
