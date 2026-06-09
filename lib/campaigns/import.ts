// Parsing serveur des imports de contacts (CSV / Excel / Google Sheets).
// SERVER-ONLY (papaparse + xlsx + clients Google). Renvoie toujours la même
// forme { headers, rows } — le client construit ensuite le mapping colonnes.

import Papa from "papaparse";
import * as XLSX from "xlsx";

import { getTenantGoogleClients } from "@/lib/google";
import { MAX_CONTACTS_PER_IMPORT } from "./constants";

export type ParsedSheet = {
  headers: string[];
  rows: string[][];
};

const cap = (rows: string[][]) => rows.slice(0, MAX_CONTACTS_PER_IMPORT);

// Détermine si la 1ère ligne est un header (heuristique : contient un libellé
// connu OU aucune cellule ne ressemble à un numéro de téléphone).
function looksLikeHeader(row: string[]): boolean {
  const joined = row.join(" ").toLowerCase();
  if (/phone|tel|téléphone|mobile|number|numéro|name|nom|email|טלפון|שם/.test(joined))
    return true;
  // Si aucune cellule ne commence par +/0/chiffre → probablement un header.
  return !row.some((c) => /^[+0-9]/.test(c.trim()));
}

function normalizeRows(matrix: string[][]): ParsedSheet {
  const clean = matrix
    .map((r) => r.map((c) => (c == null ? "" : String(c).trim())))
    .filter((r) => r.some((c) => c.length > 0));
  if (!clean.length) return { headers: [], rows: [] };

  let headers: string[];
  let body: string[][];
  if (looksLikeHeader(clean[0])) {
    headers = clean[0].map((h, i) => h || `col${i + 1}`);
    body = clean.slice(1);
  } else {
    headers = clean[0].map((_, i) => `col${i + 1}`);
    body = clean;
  }
  // Pad chaque ligne à la longueur des headers.
  body = body.map((r) => {
    const out = [...r];
    while (out.length < headers.length) out.push("");
    return out.slice(0, headers.length);
  });
  return { headers, rows: cap(body) };
}

export function parseCsv(text: string): ParsedSheet {
  const res = Papa.parse<string[]>(text, {
    skipEmptyLines: true,
  });
  const matrix = (res.data ?? []).filter(Array.isArray) as string[][];
  return normalizeRows(matrix);
}

export function parseXlsx(buf: ArrayBuffer): ParsedSheet {
  const wb = XLSX.read(buf, { type: "array" });
  const first = wb.SheetNames[0];
  if (!first) return { headers: [], rows: [] };
  const ws = wb.Sheets[first];
  const matrix = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false,
  });
  return normalizeRows(matrix as string[][]);
}

// Import depuis le Google Sheet du tenant. Réutilise le client OAuth existant.
export async function fetchSheet(
  userId: string,
  spreadsheetId: string,
  range: string,
): Promise<ParsedSheet | { notConnected: true }> {
  const clients = await getTenantGoogleClients(userId);
  if (!clients) return { notConnected: true };
  // Si spreadsheetId vide → on retombe sur le sheet par défaut du tenant.
  const sheetId = spreadsheetId || clients.sheetId;
  if (!sheetId) return { notConnected: true };

  const res = await clients.sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: range || "A:Z",
  });
  const matrix = (res.data.values ?? []) as string[][];
  return normalizeRows(matrix);
}

// Extrait un spreadsheetId depuis une URL Google Sheets ou renvoie l'entrée
// telle quelle si c'est déjà un ID.
export function extractSpreadsheetId(input: string): string {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : input.trim();
}
