/**
 * Gate admin pour les PAGES serveur (app/admin/**) — pendant côté pages du
 * guard API `requireAdmin()` de lib/api/auth-guards.ts.
 *
 * Différence avec la version API : ici on ne retourne pas une réponse 401/403,
 * on REDIRIGE (UX page) :
 *   - pas de session      → /login
 *   - session mais pas admin → /dashboard
 *
 * Retourne la row `users` complète de l'admin (jamais null : en cas d'échec
 * la fonction ne retourne pas, redirect() lève une exception Next.js).
 *
 * Usage dans une page/layout server component :
 *   const admin = await requireAdminPage();
 *
 * `requireAdminOr404()` is the same check for pages that must answer 404 to
 * everyone but a signed-in admin (no redirect that would reveal the page).
 */
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

import { SIGNED_OUT, adminOnlyOr404, isAdminViewer, type PageViewer } from "./admin-viewer";

type UserRow = typeof users.$inferSelect;

async function loadSessionUser(): Promise<{ userId: string | null; me: UserRow | null }> {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (!userId) return { userId: null, me: null };
  const [me] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return { userId, me: me ?? null };
}

/** The session viewer and its `users.role` (SIGNED_OUT when there is no session). */
export async function loadPageViewer(): Promise<PageViewer> {
  const { userId, me } = await loadSessionUser();
  if (!userId) return SIGNED_OUT;
  return { userId, role: me?.role ?? null };
}

export async function requireAdminPage(): Promise<UserRow> {
  const { userId, me } = await loadSessionUser();
  if (!userId) redirect("/login");
  if (!me || !isAdminViewer({ userId, role: me.role })) redirect("/dashboard");
  return me;
}

/** 404 for signed-out visitors and non-admin users alike. */
export function requireAdminOr404(): Promise<void> {
  return adminOnlyOr404(loadPageViewer);
}
