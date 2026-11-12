import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  experimental: {
    // Turbopack FS cache pour `next build` : persiste les artefacts dans
    // .next/cache entre builds → 2e build divisé par ~3x sur Railway si
    // le dossier est préservé (Nixpacks le fait par défaut). Stable en
    // dev depuis Next 16.1, experimental en build.
    turbopackFileSystemCacheForBuild: true,
    // app/global-not-found.tsx: the app has several root layouts (one per
    // top-level segment, no app/layout.tsx), so unmatched URLs need their own
    // 404 document.
    globalNotFound: true,
  },
};

export default withNextIntl(nextConfig);
