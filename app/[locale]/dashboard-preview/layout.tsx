import type { Metadata } from "next";

import { FullMessagesProvider } from "@/components/i18n/FullMessagesProvider";
import { requireAdminOr404 } from "@/lib/auth/require-admin-page";

// Mock dashboard for visual review: admins only. Everyone else (signed out or
// a signed-in tenant) gets a 404, and the page is never indexed. next.config.ts
// also sends `X-Robots-Tag: noindex, nofollow` on every response under it.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Same client components as /dashboard, so same full set of translations
// (public pages only ship i18n/public-namespaces).
export default async function DashboardPreviewLayout({ children }: { children: React.ReactNode }) {
  await requireAdminOr404();
  return <FullMessagesProvider>{children}</FullMessagesProvider>;
}
