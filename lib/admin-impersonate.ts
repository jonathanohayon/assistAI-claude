import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

// Résout l'`userId` effectif pour scoper une lecture côté dashboard :
//   - Par défaut : l'utilisateur authentifié.
//   - Si `?asUserId=<uuid>` est passé ET que le caller a `role==='admin'`,
//     on lit les données de ce tenant cible. Permet à l'admin d'auditer
//     le monitoring d'un tenant depuis /admin/users/[userId]/logs sans
//     dupliquer endpoints/UI.
//
// Retourne `null` si le `asUserId` cible est demandé mais le caller n'est
// pas admin (l'endpoint doit alors 403) ou n'existe pas. Sinon retourne
// l'UUID à utiliser.
export async function resolveScopeUserId(opts: {
  sessionUserId: string;
  asUserId: string | null;
}): Promise<{ userId: string } | { forbidden: true }> {
  if (!opts.asUserId || opts.asUserId === opts.sessionUserId) {
    return { userId: opts.sessionUserId };
  }
  const [me] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, opts.sessionUserId))
    .limit(1);
  if (me?.role !== "admin") return { forbidden: true };
  return { userId: opts.asUserId };
}
