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
 */
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export async function requireAdminPage(): Promise<typeof users.$inferSelect> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [me] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!me || me.role !== "admin") redirect("/dashboard");

  return me;
}
