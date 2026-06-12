import { NextRequest, NextResponse } from "next/server";

import { extractApiKey, resolveApiKey } from "@/lib/api-keys";
import { isCallSubject } from "@/lib/call-subject";
import { normalizePhoneForDedup } from "@/lib/phone-utils";
import { queryTranscripts } from "@/lib/transcripts";

/**
 * API publique v1 — transcripts des appels d'un tenant, pour une app externe
 * (journal). Auth par clé API tenant-scoped (Authorization: Bearer <key> ou
 * header x-api-key). Le numéro `phone` est OBLIGATOIRE : on ne renvoie que les
 * conversations de/vers ce numéro.
 *
 * GET /api/v1/transcripts?phone=+972...&direction=all&subject=appointment
 *      &from=2026-06-01&to=2026-06-12&order=desc&limit=50&offset=0
 *
 * Réponse : { phone, count, limit, offset, items: [{
 *   id, direction: "inbound"|"outbound", subject, name, phone, language,
 *   durationSeconds, date (ISO 8601), summary, transcript: [{role,text}]
 * }] }  — items triés par date.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Parse une borne de date. Date seule (YYYY-MM-DD) → début ou fin de journée. */
export function parseTranscriptDate(
  v: string | null,
  endOfDay = false,
): Date | null {
  if (!v) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
  const d = new Date(dateOnly && endOfDay ? `${v}T23:59:59.999Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest) {
  const rawKey = extractApiKey(req);
  if (!rawKey) {
    return NextResponse.json(
      { error: "missing_api_key", message: "Fournissez une clé via 'Authorization: Bearer <key>' ou l'en-tête 'x-api-key'." },
      { status: 401 },
    );
  }
  const userId = await resolveApiKey(rawKey);
  if (!userId) {
    return NextResponse.json(
      { error: "invalid_api_key", message: "Clé API invalide ou révoquée." },
      { status: 401 },
    );
  }

  const sp = req.nextUrl.searchParams;

  const phone = (sp.get("phone") ?? "").trim();
  if (!phone) {
    return NextResponse.json(
      { error: "phone_required", message: "Le paramètre 'phone' est obligatoire (numéro dont vous voulez les conversations)." },
      { status: 400 },
    );
  }
  if (normalizePhoneForDedup(phone).length < 6) {
    return NextResponse.json(
      { error: "invalid_phone", message: "Numéro 'phone' invalide." },
      { status: 400 },
    );
  }

  const direction = (sp.get("direction") ?? "all").toLowerCase();
  if (!["all", "inbound", "outbound"].includes(direction)) {
    return NextResponse.json(
      { error: "invalid_direction", message: "direction doit être 'inbound', 'outbound' ou 'all'." },
      { status: 400 },
    );
  }
  const subjectParam = sp.get("subject");
  if (subjectParam && !isCallSubject(subjectParam)) {
    return NextResponse.json(
      { error: "invalid_subject", message: "subject doit être l'un de : appointment, cancellation, reschedule, message, info, other." },
      { status: 400 },
    );
  }
  const from = parseTranscriptDate(sp.get("from"));
  const to = parseTranscriptDate(sp.get("to"), true);
  if (sp.get("from") && !from) {
    return NextResponse.json({ error: "invalid_from" }, { status: 400 });
  }
  if (sp.get("to") && !to) {
    return NextResponse.json({ error: "invalid_to" }, { status: 400 });
  }
  const order = (sp.get("order") ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(sp.get("limit") ?? `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT),
  );
  const offset = Math.max(0, parseInt(sp.get("offset") ?? "0", 10) || 0);

  const { count, items } = await queryTranscripts(userId, {
    phone,
    direction: direction as "all" | "inbound" | "outbound",
    subject: isCallSubject(subjectParam) ? subjectParam : null,
    from,
    to,
    order,
    limit,
    offset,
  });

  return NextResponse.json({ phone, count, limit, offset, items });
}
