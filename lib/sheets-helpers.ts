// Helpers pour Google Sheets — création idempotente, dedupe, prepend.
//
// Concepts clés :
// - "force text phone" : Sheets parse "0585001007" en number → drop le 0
//   initial. Préfixer avec apostrophe (`'`) force le format texte
//   visuellement invisible. Marche dans tous les calculs/recherches.
// - "ensureSheet" : crée le tab si absent + écrit la ligne d'en-têtes.
//   Idempotent : safe à appeler à chaque opération.
// - "upsertByKey" : recherche linéaire d'une row par clé composite
//   (nom + tel normalisés). Si match → update, sinon append.
// - "prependRow" : insertDimension à row 1 (sous le header) + write des
//   valeurs → la nouvelle row est en haut sans avoir à re-trier toute
//   la sheet.

import type { sheets_v4 } from "@googleapis/sheets";

/**
 * Préfixe avec une apostrophe pour forcer Sheets à traiter comme texte.
 * Sans ça, "0585001007" devient 585001007 (le 0 initial tombe).
 * L'apostrophe ne s'affiche PAS dans la cellule, mais reste stockée.
 */
export const forceTextPhone = (phone: string): string => {
  const trimmed = (phone ?? "").trim();
  if (!trimmed) return "";
  return trimmed.startsWith("'") ? trimmed : `'${trimmed}`;
};

/**
 * Normalise un numéro pour la dedupe (digits only, trailing/leading whitespace
 * supprimés). N'altère PAS la valeur stockée — sert uniquement à matcher
 * "0585001007" et "058 500 10 07" comme la même clé.
 */
export const normalizePhone = (phone: string): string =>
  (phone ?? "").replace(/[^\d]/g, "");

/**
 * Normalise un nom : trim, lowercase, espaces multiples → 1.
 * Pour la dedupe (nom + tel) en case-insensitive.
 */
export const normalizeName = (name: string): string =>
  (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");

interface EnsureSheetOptions {
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
  title: string;
  /** Headers à écrire dans la première ligne si la sheet est créée. */
  headers: string[];
}

/**
 * Crée le tab si absent. Si créé, écrit la ligne d'en-têtes. Idempotent :
 * appel suivant = no-op. Retourne l'ID interne du sheet (sheetId, pas
 * spreadsheetId — c'est l'ID du TAB) qui sert pour insertDimension.
 */
export async function ensureSheet({
  sheets,
  spreadsheetId,
  title,
  headers,
}: EnsureSheetOptions): Promise<number> {
  // Lire la liste des sheets pour voir si elle existe déjà.
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets?.find(
    (s) => s.properties?.title === title,
  );
  if (existing?.properties?.sheetId != null) {
    return existing.properties.sheetId;
  }

  // Crée le tab + écrit les headers en une seule transaction.
  const created = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  });
  const newSheetId =
    created.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!A1:${columnLetter(headers.length)}1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] },
  });

  return newSheetId;
}

/**
 * A → 1, B → 2, ..., AA → 27, etc. Inverse pour columnLetter.
 */
const columnLetter = (n: number): string => {
  let s = "";
  let r = n;
  while (r > 0) {
    const m = (r - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    r = Math.floor((r - 1) / 26);
  }
  return s;
};

interface UpsertByKeyOptions {
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
  sheetTitle: string;
  /** Index de colonnes (0-based) qui forment la clé composite. Ex: [0,1] = nom + tel. */
  keyColumnIndexes: number[];
  /** Fonction de normalisation à appliquer aux valeurs de chaque colonne-clé avant comparaison. */
  normalize: (colIndex: number, value: string) => string;
  /** Valeurs de la nouvelle ligne (array, ordre = colonnes). */
  newRow: string[];
  /**
   * Optionnel : merge custom quand on update une ligne existante. Reçoit
   * (existingRow, newRow) → mergedRow. Par défaut : remplace toute la row
   * avec newRow (mais préserve la 1re colonne "premier contact" si fournie).
   */
  mergeFn?: (existing: string[], next: string[]) => string[];
}

interface UpsertByKeyResult {
  action: "inserted" | "updated";
  rowIndex: number; // 0-based, header = 0, première data row = 1
}

export async function upsertByKey({
  sheets,
  spreadsheetId,
  sheetTitle,
  keyColumnIndexes,
  normalize,
  newRow,
  mergeFn,
}: UpsertByKeyOptions): Promise<UpsertByKeyResult> {
  const range = `${sheetTitle}!A:${columnLetter(newRow.length)}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  const rows = (res.data.values ?? []) as string[][];

  // Cherche une ligne existante (skip row 0 = header) avec clé matching.
  const newKey = keyColumnIndexes
    .map((i) => normalize(i, newRow[i] ?? ""))
    .join("|");

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const key = keyColumnIndexes
      .map((i) => normalize(i, row[i] ?? ""))
      .join("|");
    if (key && key === newKey) {
      const merged = mergeFn ? mergeFn(row, newRow) : newRow;
      const sheetRange = `${sheetTitle}!A${r + 1}:${columnLetter(merged.length)}${r + 1}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: sheetRange,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [merged] },
      });
      return { action: "updated", rowIndex: r };
    }
  }

  // Pas trouvé → append.
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetTitle}!A:A`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [newRow] },
  });
  return { action: "inserted", rowIndex: rows.length };
}

interface PrependRowOptions {
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
  sheetId: number; // L'ID interne du TAB (depuis ensureSheet), pas spreadsheetId
  sheetTitle: string;
  newRow: string[];
}

/**
 * Insère une nouvelle ligne juste sous le header (row index 1 en 0-based,
 * = ligne 2 en notation A1). Garantit "le plus récent en haut" sans
 * re-trier toute la sheet à chaque appel.
 *
 * Implémentation en 2 étapes via batchUpdate :
 *   1. insertDimension à startIndex=1, endIndex=2 → ouvre une row vide
 *   2. updateCells pour remplir les valeurs dans cette nouvelle row
 *
 * Atomique côté API : un seul batchUpdate.
 */
export async function prependRow({
  sheets,
  spreadsheetId,
  sheetId,
  sheetTitle,
  newRow,
}: PrependRowOptions): Promise<void> {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          insertDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: 1,
              endIndex: 2,
            },
            inheritFromBefore: false,
          },
        },
      ],
    },
  });
  // Le insertDimension a déplacé toutes les rows existantes d'un cran.
  // On écrit dans la nouvelle row vide (= ligne 2 en A1 notation).
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetTitle}!A2:${columnLetter(newRow.length)}2`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [newRow] },
  });
}
