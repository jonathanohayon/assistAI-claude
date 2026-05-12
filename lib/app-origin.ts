import { headers } from "next/headers";

/**
 * Renvoie l'origine canonique de l'app (ex: "https://aitamara.com") en se
 * basant sur les headers de la request HTTP en cours. Permet d'avoir un
 * URL juste sans dépendre d'une env var hardcodée — change automatiquement
 * si tu pointes le domaine custom Railway sur un autre host.
 *
 * Priorité :
 *   1. headers().host + x-forwarded-proto → l'origine actuelle de la request
 *   2. AUTH_URL env var → fallback côté contextes hors-request (cron, etc.)
 *   3. APP_URL env var → legacy
 *   4. http://localhost:3000 → dev local
 *
 * Important : les OAuth callback URIs (Google) DOIVENT être pré-déclarées
 * dans la Cloud Console, donc pour les redirect_uri envoyés à Google on
 * garde la priorité env var (AUTH_URL) — voir lib/google.ts.
 * Ce helper sert uniquement aux URLs DÉRIVÉES du host courant (display,
 * server actions, etc.).
 */
export async function getAppOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto =
      h.get("x-forwarded-proto") ??
      (host?.startsWith("localhost") ? "http" : "https");
    if (host) return `${proto}://${host}`;
  } catch {
    /* en dehors d'un contexte request — fallback env */
  }
  return (
    process.env.AUTH_URL ??
    process.env.APP_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}
