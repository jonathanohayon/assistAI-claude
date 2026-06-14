// Liste les Google Sheets du Drive d'un tenant SANS ajouter de dépendance npm.
//
// On évite le package @googleapis/drive (200+ APIs) en appelant l'API REST
// Drive v3 directement avec fetch. L'access token est dérivé du refresh token
// du tenant via l'OAuth2 client de lib/google.ts (getAuthenticatedClientFor).
//
// IMPORTANT scope : lister les fichiers Drive requiert le scope drive(.metadata)
// .readonly. Les tenants connectés AVANT l'ajout de ce scope n'ont consenti
// qu'à calendar+spreadsheets → l'API Drive répond 403 insufficientPermissions.
// On le détecte et on renvoie { ok:false, scopeMissing:true } pour que l'UI
// propose un re-consentement plutôt que d'afficher une erreur opaque.

import { getAuthenticatedClientFor } from "@/lib/google";
import { logEvent } from "@/lib/logger";

export type DriveFile = { id: string; name: string };

export type ListSpreadsheetsResult =
  | { ok: true; files: DriveFile[] }
  // scopeMissing : le tenant n'a pas consenti au scope Drive → re-consentement.
  // apiDisabled : l'API Google Drive n'est pas activée sur le projet Cloud →
  //   à activer dans la console (un re-consentement n'y changera rien).
  | { ok: false; scopeMissing: boolean; apiDisabled?: boolean };

const DRIVE_FILES_URL =
  "https://www.googleapis.com/drive/v3/files" +
  "?q=" +
  encodeURIComponent(
    "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
  ) +
  "&fields=" +
  encodeURIComponent("files(id,name)") +
  "&pageSize=100" +
  "&supportsAllDrives=true&includeItemsFromAllDrives=true" +
  "&orderBy=" +
  encodeURIComponent("modifiedTime desc");

/**
 * Renvoie les spreadsheets du Drive du tenant (max 100, plus récents d'abord).
 * Robuste : toute erreur réseau/parse → { ok:false, scopeMissing:false }.
 * Distingue scope manquant (re-consentement) vs API Drive désactivée (config
 * Cloud). Logge le corps d'erreur Drive pour diagnostic (/dashboard/logs).
 */
export async function listSpreadsheets(
  refreshToken: string,
): Promise<ListSpreadsheetsResult> {
  try {
    const oauth = getAuthenticatedClientFor(refreshToken);
    const { token } = await oauth.getAccessToken();
    if (!token) return { ok: false, scopeMissing: false };

    const res = await fetch(DRIVE_FILES_URL, {
      headers: { Authorization: `Bearer ${token}` },
      // On ne veut jamais de cache Next sur un appel authentifié par tenant.
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // API Drive non activée sur le projet (≠ scope manquant) :
      // "accessNotConfigured" / "SERVICE_DISABLED" / "has not been used/enabled".
      const apiDisabled =
        /accessNotConfigured|SERVICE_DISABLED|has not been used|has not been enabled|API has not been/i.test(
          body,
        );
      // Scope insuffisant → re-consentement utile.
      const scopeMissing =
        !apiDisabled &&
        (res.status === 401 ||
          /insufficient|scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/i.test(
            body,
          ) ||
          res.status === 403);
      void logEvent({
        source: "sheets",
        event: "drive_list_failed",
        message: `Drive files.list → HTTP ${res.status} (apiDisabled=${apiDisabled}, scopeMissing=${scopeMissing})`,
        level: "warn",
        metadata: { status: res.status, body: body.slice(0, 400) },
      });
      return { ok: false, scopeMissing, apiDisabled };
    }

    const data = (await res.json()) as {
      files?: Array<{ id?: string; name?: string }>;
    };
    const files: DriveFile[] = (data.files ?? [])
      .filter((f): f is { id: string; name?: string } => typeof f.id === "string")
      .map((f) => ({ id: f.id, name: f.name ?? "(sans nom)" }));
    return { ok: true, files };
  } catch (e) {
    void logEvent({
      source: "sheets",
      event: "drive_list_error",
      message: `Drive files.list exception : ${(e as Error).message?.slice(0, 200)}`,
      level: "error",
    });
    return { ok: false, scopeMissing: false };
  }
}
