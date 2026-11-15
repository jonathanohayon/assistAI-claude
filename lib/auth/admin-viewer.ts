/**
 * The admin decision shared by every admin-only server page, kept free of
 * db/auth imports so it can be unit-tested (scripts/tests/dashboard-preview-gate.test.ts).
 *
 * The loader lives in require-admin-page.ts (session via auth(), then the
 * `users` row): `requireAdminPage()` redirects on failure (app/admin/**),
 * `requireAdminOr404()` answers 404 (pages that must not reveal they exist,
 * such as /[locale]/dashboard-preview/**).
 */
import { notFound } from "next/navigation";

export type PageViewer = {
  /** Session user id, null when signed out. */
  userId: string | null;
  /** `users.role` of that id, null when signed out or the row is gone. */
  role: string | null;
};

export const SIGNED_OUT: PageViewer = { userId: null, role: null };

export function isAdminViewer(viewer: PageViewer): boolean {
  return viewer.userId !== null && viewer.role === "admin";
}

/**
 * Loads the viewer and calls notFound() unless it is a signed-in admin.
 * Signed-out visitors and signed-in tenants get the same 404.
 */
export async function adminOnlyOr404(load: () => Promise<PageViewer>): Promise<void> {
  const viewer = await load();
  if (!isAdminViewer(viewer)) notFound();
}
