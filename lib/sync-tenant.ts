// Synchronisation Calendar → Sheet "Clients" pour un tenant.
//
// Use case : le proprio crée un événement manuellement dans Google Calendar
// (app mobile, web, etc.). Notre sync détecte les events récents, extrait
// les contacts (depuis le champ description que book_appointment écrit déjà
// au format "Tel : XXX" / "Email : YYY") et les upsert dans la sheet
// Clients via le helper dedupe.
//
// Stratégie :
//   - Read Calendar events de J-7 à J+30 (window glissante pour capter les
//     créations passées + futures).
//   - Pour chaque event, extraire { name, phone, email } depuis summary +
//     description.
//   - upsertByKey dans Clients (dedupe par nom + tel normalisés).
//   - Best-effort : skip les events sans téléphone identifiable.
//
// V1 = Calendar → Clients uniquement. Sheet → Calendar = V2 (manual RDV
// entry depuis dashboard form, avec datetime explicite).

import {
  ensureSheet,
  forceTextPhone,
  normalizeName,
  normalizePhone,
  upsertByKey,
} from "@/lib/sheets-helpers";
import { getTenantGoogleClients } from "@/lib/google";

const CLIENTS_SHEET_TITLE = "Clients";
const CLIENTS_HEADERS = [
  "Nom",
  "Téléphone",
  "Email",
  "Notes",
  "Premier contact",
  "Dernière mise à jour",
];

export interface SyncTenantResult {
  ok: boolean;
  reason?: string;
  scanned: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/**
 * Extrait les coordonnées d'un event Calendar.
 * book_appointment écrit le summary "RDV Jérusalem — Sarah" et la description :
 *   Soin du visage
 *   Centre : Jérusalem
 *   Tel : 0585001007
 *   Email : sarah@...
 *
 * On parse :
 *   - name : depuis summary après le " — " (séparateur), fallback summary entier
 *   - phone : depuis ligne "Tel : ..." OU "Téléphone : ..."
 *   - email : depuis ligne "Email : ..." OU "E-mail : ..."
 */
const parseEvent = (
  event: { summary?: string | null; description?: string | null },
): { name: string; phone: string; email: string } | null => {
  const summary = (event.summary ?? "").trim();
  const description = (event.description ?? "").trim();

  // Name : après " — " ou " - " si présent (book_appointment format), sinon summary brut
  let name = summary;
  const dashSplit = summary.split(/\s+[—–-]\s+/);
  if (dashSplit.length >= 2 && dashSplit[1]) {
    name = dashSplit[dashSplit.length - 1]?.trim() ?? summary;
  }

  // Phone : "Tel:" / "Téléphone:" / "Tél:" / "Phone:" — case insensitive
  const phoneMatch = description.match(
    /(?:tel|t[ée]l[ée]phone|phone)\s*[:：]\s*([+\d\s()\-.]+)/i,
  );
  const phone = phoneMatch?.[1]?.trim() ?? "";

  // Email
  const emailMatch = description.match(
    /(?:e[-\s]?mail|email)\s*[:：]\s*([^\s\n]+@[^\s\n]+)/i,
  );
  const email = emailMatch?.[1]?.trim() ?? "";

  if (!phone || !name) return null;
  return { name, phone, email };
};

/**
 * Synchronise les events Calendar récents vers la sheet Clients du tenant.
 * Best-effort : retourne un résumé, ne throw jamais.
 */
export async function syncTenantCalendarToSheet(
  userId: string,
): Promise<SyncTenantResult> {
  const result: SyncTenantResult = {
    ok: false,
    scanned: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  const google = await getTenantGoogleClients(userId);
  if (!google) {
    result.reason = "no_google_credentials";
    return result;
  }
  if (!google.sheetId) {
    result.reason = "no_sheet_id";
    return result;
  }
  const spreadsheetId = google.sheetId;

  // Window : J-7 → J+30 pour capter les créations passées récentes ET les
  // futurs RDV. Asia/Jerusalem-agnostic (UTC dates).
  const now = new Date();
  const timeMin = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  const timeMax = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString();

  let events: Array<{ summary?: string | null; description?: string | null }> = [];
  try {
    const res = await google.calendar.events.list({
      calendarId: google.calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      maxResults: 250,
      orderBy: "startTime",
      timeZone: "Asia/Jerusalem",
    });
    events = res.data.items ?? [];
  } catch (e) {
    result.errors.push(`events.list: ${(e as Error).message}`);
    result.reason = "calendar_fetch_failed";
    return result;
  }

  // Ensure la sheet Clients existe avec les bons headers.
  try {
    await ensureSheet({
      sheets: google.sheets,
      spreadsheetId,
      title: CLIENTS_SHEET_TITLE,
      headers: CLIENTS_HEADERS,
    });
  } catch (e) {
    result.errors.push(`ensureSheet: ${(e as Error).message}`);
    return result;
  }

  result.scanned = events.length;
  const stamp = now.toLocaleString("fr-FR", { timeZone: "Asia/Jerusalem" });

  for (const event of events) {
    const parsed = parseEvent(event);
    if (!parsed) {
      result.skipped++;
      continue;
    }
    try {
      const upsert = await upsertByKey({
        sheets: google.sheets,
        spreadsheetId,
        sheetTitle: CLIENTS_SHEET_TITLE,
        keyColumnIndexes: [0, 1],
        normalize: (col, value) =>
          col === 0 ? normalizeName(value) : normalizePhone(value),
        newRow: [
          parsed.name,
          forceTextPhone(parsed.phone),
          parsed.email,
          // Notes : signe l'origine pour qu'on voie d'où vient cette ligne
          // si jamais il y a un doute.
          `Sync depuis Calendar`,
          stamp,
          stamp,
        ],
        mergeFn: (existing, next) => {
          const existingNotes = existing[3] ?? "";
          const newNotes = next[3] ?? "";
          const mergedNotes = existingNotes.includes(newNotes)
            ? existingNotes
            : `${existingNotes} | ${newNotes}`;
          return [
            existing[0] ?? next[0],
            next[1],
            next[2] || existing[2] || "",
            mergedNotes,
            existing[4] ?? next[4],
            next[5],
          ];
        },
      });
      if (upsert.action === "inserted") result.inserted++;
      else result.updated++;
    } catch (e) {
      result.errors.push(`upsert: ${(e as Error).message}`);
    }
  }

  result.ok = true;
  return result;
}
