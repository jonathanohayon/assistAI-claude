import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// Admin-only mock dashboard (app/[locale]/dashboard-preview/**): never indexed,
// whatever the status (404 for everyone but a signed-in admin, see its layout).
const NOINDEX_PATHS = [
  "/dashboard-preview/:path*",
  "/:locale(fr|en|he)/dashboard-preview/:path*",
];

const nextConfig: NextConfig = {
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
