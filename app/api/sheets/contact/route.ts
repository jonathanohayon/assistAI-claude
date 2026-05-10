import { NextRequest, NextResponse } from "next/server";

import { resolveAgentCallerGoogle } from "@/lib/google";
import { logEvent } from "@/lib/logger";
import {
  ensureSheet,
  forceTextPhone,
  normalizeName,
  normalizePhone,
  upsertByKey,
} from "@/lib/sheets-helpers";

const CLIENTS_SHEET_TITLE = "Clients";
const CLIENTS_HEADERS = [
  "Nom",
  "Téléphone",
  "Email",
  "Notes",
  "Premier contact",
  "Dernière mise à jour",
];

// Upsert dans la sheet "Clients" : dedupe par (nom + tel) normalisés.
// - Si la combinaison existe : merge les notes (append séparé par " | "),
//   met à jour la "Dernière mise à jour", garde le "Premier contact" original.
// - Sinon : nouvelle ligne avec les 2 dates = now.
//
// Téléphone forcé en texte (préfixe apostrophe) → Sheets ne drop plus le 0.
export async function POST(req: NextRequest) {
  const { name, phone, email = "", notes = "" } = await req.json();

  if (!name || !phone) {
    return NextResponse.json(
      { error: "Nom et téléphone requis" },
      { status: 400 },
    );
  }

  const caller = await resolveAgentCallerGoogle(req);
  if (caller.mode === "user_no_google") {
    return NextResponse.json(
      { error: "Google Sheet non connecté pour ce compte." },
      { status: 409 },
    );
  }
  if (caller.mode === "unknown_tenant") {
    return NextResponse.json(
      { error: `Tenant inconnu pour ${caller.dialedPhone || "(numéro absent)"}` },
      { status: 404 },
    );
  }
  if (!caller.sheetId) {
    await logEvent({
      source: "sheets",
      event: "contact_misconfigured",
      message:
        caller.mode === "demo"
          ? "GOOGLE_SHEET_ID non configuré"
          : "Sheet ID manquant pour ce compte",
      level: "error",
    });
    return NextResponse.json(
      { error: "Aucun Google Sheet configuré pour ce compte." },
      { status: 500 },
    );
  }
  const spreadsheetId = caller.sheetId;
  const now = new Date().toLocaleString("fr-FR", {
    timeZone: "Asia/Jerusalem",
  });

  try {
    await ensureSheet({
      sheets: caller.sheets,
      spreadsheetId,
      title: CLIENTS_SHEET_TITLE,
      headers: CLIENTS_HEADERS,
    });

    const newRow = [
      name,
      forceTextPhone(phone),
      email,
      notes,
      now, // Premier contact (sera préservé via mergeFn si la row existe)
      now, // Dernière mise à jour
    ];

    const result = await upsertByKey({
      sheets: caller.sheets,
      spreadsheetId,
      sheetTitle: CLIENTS_SHEET_TITLE,
      keyColumnIndexes: [0, 1], // nom + téléphone
      normalize: (col, value) =>
        col === 0 ? normalizeName(value) : normalizePhone(value),
      newRow,
      // Préserve "Premier contact" original ; append les nouvelles notes
      // si différentes ; met à jour "Dernière mise à jour".
      mergeFn: (existing, next) => {
        const existingNotes = existing[3] ?? "";
        const newNotes = next[3] ?? "";
        const mergedNotes =
          newNotes && existingNotes && !existingNotes.includes(newNotes)
            ? `${existingNotes} | ${newNotes}`
            : newNotes || existingNotes;
        return [
          existing[0] ?? next[0], // garde le nom existant (typo cliente possible)
          next[1], // tel à jour
          next[2] || existing[2] || "", // garde email si vide en input
          mergedNotes,
          existing[4] ?? next[4], // PRÉSERVE Premier contact
          next[5], // updated to now
        ];
      },
    });

    await logEvent({
      source: "sheets",
      event: result.action === "inserted" ? "client_added" : "client_updated",
      message: `Client ${result.action === "inserted" ? "ajouté" : "mis à jour"} : ${name} · ${phone}`,
      metadata: { name, phone, email, notes, action: result.action },
    });

    return NextResponse.json({
      success: true,
      action: result.action,
      message:
        result.action === "inserted"
          ? `Nouveau client ${name} ajouté`
          : `Client ${name} mis à jour`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur Sheets";
    await logEvent({
      source: "sheets",
      event: "contact_failed",
      message: `Upsert client échoué : ${msg.slice(0, 200)}`,
      level: "error",
      metadata: { name, phone, error: msg },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
