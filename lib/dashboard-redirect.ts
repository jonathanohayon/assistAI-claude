// SERVER-ONLY: the old dashboard URLs, redirected to their new home (the
// left menu's routes, lib/dashboard-nav.ts). Each old page.tsx calls one of
// these, so a bookmark, an e-mail link or an OAuth return to an old URL keeps
// working, client navigation included. The query string is kept.

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { requireAdminPage } from "@/lib/auth/require-admin-page";
import { legacyTarget, type SearchParams } from "@/lib/dashboard-nav";
import { getAccountDoor } from "@/lib/door";

/** /{locale}/dashboard<oldSuffix> → its new URL (the own product for /dashboard). */
export async function redirectTenantLegacy(locale: string, oldSuffix: string, search: SearchParams): Promise<never> {
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);
  const door = oldSuffix === "" ? await getAccountDoor(session.user.id) : null;
  const to = legacyTarget(oldSuffix, search, door);
  redirect(`/${locale}${to ?? "/dashboard"}`);
}

/** /admin/users/<id><oldSuffix> → its new URL (the tenant's own product for the view itself). */
export async function redirectAdminLegacy(userId: string, oldSuffix: string, search: SearchParams): Promise<never> {
  await requireAdminPage();
  const door = oldSuffix === "" ? await getAccountDoor(userId) : null;
  const to = legacyTarget(oldSuffix, search, door, userId);
  redirect(to ?? "/admin");
}
