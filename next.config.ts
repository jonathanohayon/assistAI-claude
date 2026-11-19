import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// Admin-only mock dashboard (app/[locale]/dashboard-preview/**): never indexed,
// whatever the status (404 for everyone but a signed-in admin, see its layout).
const NOINDEX_PATHS = [
  "/dashboard-preview/:path*",
  "/:locale(fr|en|he)/dashboard-preview/:path*",
];

// The admin lives at /admin (no locale). A locale-prefixed /{fr,en,he}/admin
// URL used to fall through next-intl into app/[locale] and answer 404, so it
// is sent to the unprefixed path instead. next.config redirects run before the
// proxy (proxy.ts) and before any render: the response is a bare 307 with a
// Location header, and /admin's own gate (requireAdminPage) then decides
// (signed out → /login, non-admin → /dashboard). `:path*` matches zero or more
// whole segments, so /fr/admin and /fr/admin/a/b match but /fr/admin-foo,
// /fr/admins, /fr/administration and /fr/dashboard/admin don't. The query
// string is passed through by Next. Temporary (307, not 308): browsers cache a
// 308 forever, and we may want /{locale}/admin to mean something else later.
export const LOCALE_ADMIN_REDIRECTS = [
  {
    source: "/:locale(fr|en|he)/admin/:path*",
    destination: "/admin/:path*",
    permanent: false,
  },
] as const;

const nextConfig: NextConfig = {
  async redirects() {
    return LOCALE_ADMIN_REDIRECTS.map((r) => ({ ...r }));
  },
  async headers() {
    return NOINDEX_PATHS.map((source) => ({
      source,
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
    }));
  },
  experimental: {
    // Turbopack FS cache pour `next build` : persiste les artefacts dans
    // .next/cache entre builds → 2e build divisé par ~3x sur Railway si
    // le dossier est préservé (Nixpacks le fait par défaut). Stable en
    // dev depuis Next 16.1, experimental en build.
    turbopackFileSystemCacheForBuild: true,
  },
};

export default withNextIntl(nextConfig);
