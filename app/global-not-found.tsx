import type { Metadata } from "next";
import Link from "next/link";

import { RootHtml } from "./_root/root-html";
import { routing } from "@/i18n/routing";

// 404 for URLs that match no route. Needed because the app has several root
// layouts and no app/layout.tsx to compose a default 404 from
// (experimental.globalNotFound in next.config.ts).
export const metadata: Metadata = {
  title: "404 — Tamara",
};

export default function GlobalNotFound() {
  return (
    <RootHtml locale={routing.defaultLocale}>
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-2xl font-semibold">404</h1>
        <p>Page introuvable · Page not found · הדף לא נמצא</p>
        <Link href="/" className="underline">
          Tamara
        </Link>
      </main>
    </RootHtml>
  );
}
