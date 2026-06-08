import type { NextRequest } from "next/server";

import { auth } from "@/auth";
import { resolveScopeUserId } from "@/lib/admin-impersonate";

// Résout l'userId effectif pour une route dashboard : session.user.id par
// défaut, OU asUserId si le caller est admin (sinon 403). Même pattern que
// app/api/dashboard/contacts/route.ts, centralisé pour les routes campagnes.
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
