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

export type DriveFile = { id: string; name: string };

export type ListSpreadsheetsResult =
  | { ok: true; files: DriveFile[] }
  | { ok: false; scopeMissing: boolean };

const DRIVE_FILES_URL =
  "https://www.googleapis.com/drive/v3/files" +
  "?q=" +
  encodeURIComponent(
    "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
  ) +
  "&fields=" +
  encodeURIComponent("files(id,name)") +
  "&pageSize=100" +
  "&orderBy=" +
  encodeURIComponent("modifiedTime desc");

/**
 * Renvoie les spreadsheets du Drive du tenant (max 100, plus récents d'abord).
 * Robuste : toute erreur réseau/parse → { ok:false, scopeMissing:false }.
 * 403/insufficient scope → { ok:false, scopeMissing:true }.
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
      // 403 insufficientPermissions / ACCESS_TOKEN_SCOPE_INSUFFICIENT →
      // le tenant n'a pas (encore) consenti au scope Drive.
      if (res.status === 403 || res.status === 401) {
        const body = await res.text().catch(() => "");
        const scopeMissing =
          res.status === 403 ||
          /insufficient|scope|insufficientPermissions/i.test(body);
        return { ok: false, scopeMissing };
      }
      return { ok: false, scopeMissing: false };
    }

    const data = (await res.json()) as {
      files?: Array<{ id?: string; name?: string }>;
    };
    const files: DriveFile[] = (data.files ?? [])
      .filter((f): f is { id: string; name?: string } => typeof f.id === "string")
      .map((f) => ({ id: f.id, name: f.name ?? "(sans nom)" }));
    return { ok: true, files };
  } catch {
    return { ok: false, scopeMissing: false };
  }
}
