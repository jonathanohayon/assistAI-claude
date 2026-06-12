import { and, desc, eq, gte, lte } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { extractApiKey, resolveApiKey } from "@/lib/api-keys";
import { deriveSubject, isCallSubject } from "@/lib/call-subject";
import { db } from "@/lib/db";
import {
  agentConfigs,
  calls,
  campaignCalls,
  campaignContacts,
} from "@/lib/db/schema";
import { normalizePhoneForDedup } from "@/lib/phone-utils";

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

const MAX_FETCH = 2000; // borne de sécurité (un seul numéro → volume faible)
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type Item = {
  id: string;
  direction: "inbound" | "outbound";
  subject: string;
  name: string | null;
  phone: string;
  language: string;
  durationSeconds: number;
  date: string;
  summary: string;
  transcript: Array<{ role: "user" | "assistant"; text: string }>;
};

function parseDate(v: string | null, endOfDay = false): Date | null {
  if (!v) return null;
  // Date seule (YYYY-MM-DD) → début ou fin de journée pour des bornes inclusives.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
  const d = new Date(dateOnly && endOfDay ? `${v}T23:59:59.999Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────
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

  // ── phone OBLIGATOIRE ───────────────────────────────────────────────
  const phoneParam = (sp.get("phone") ?? "").trim();
  if (!phoneParam) {
    return NextResponse.json(
      { error: "phone_required", message: "Le paramètre 'phone' est obligatoire (numéro dont vous voulez les conversations)." },
      { status: 400 },
    );
  }
  const phoneDigits = normalizePhoneForDedup(phoneParam);
  if (phoneDigits.length < 6) {
    return NextResponse.json(
      { error: "invalid_phone", message: "Numéro 'phone' invalide." },
      { status: 400 },
    );
  }
  // Match tolérant au format/indicatif : égalité sur les digits, ou l'un se
  // termine par l'autre (gère +972XXX vs 0XXX) à partir de 7 chiffres communs.
  const phoneMatches = (stored: string): boolean => {
    const a = normalizePhoneForDedup(stored);
    if (!a) return false;
    if (a === phoneDigits) return true;
    const min = Math.min(a.length, phoneDigits.length);
    return min >= 7 && (a.endsWith(phoneDigits) || phoneDigits.endsWith(a));
  };

  // ── Filtres ─────────────────────────────────────────────────────────
  const direction = (sp.get("direction") ?? "all").toLowerCase();
  if (!["all", "inbound", "outbound"].includes(direction)) {
    return NextResponse.json(
      { error: "invalid_direction", message: "direction doit être 'inbound', 'outbound' ou 'all'." },
      { status: 400 },
    );
  }
  const subject = sp.get("subject");
  if (subject && !isCallSubject(subject)) {
    return NextResponse.json(
      { error: "invalid_subject", message: "subject doit être l'un de : appointment, cancellation, reschedule, message, info, other." },
      { status: 400 },
    );
  }
  const from = parseDate(sp.get("from"));
  const to = parseDate(sp.get("to"), true);
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

  // ── Langue du tenant (proxy pour la langue d'accueil de l'agent) ─────
  const [cfg] = await db
    .select({ language: agentConfigs.primaryLanguage })
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId))
    .limit(1);
  const language = cfg?.language ?? "fr";

  const items: Item[] = [];

  // ── Inbound (table calls) ───────────────────────────────────────────
  if (direction !== "outbound") {
    const conds = [eq(calls.userId, userId)];
    if (from) conds.push(gte(calls.createdAt, from));
    if (to) conds.push(lte(calls.createdAt, to));
    const rows = await db
      .select()
      .from(calls)
      .where(and(...conds))
      .orderBy(desc(calls.createdAt))
      .limit(MAX_FETCH);
    for (const r of rows) {
      if (!phoneMatches(r.fromNumber)) continue;
      items.push({
        id: r.id,
        direction: "inbound",
        subject: deriveSubject(r.summary, r.transcript),
        name: null, // non capturé de façon fiable côté entrant (v1)
        phone: r.fromNumber,
        language,
        durationSeconds: r.durationSeconds,
        date: r.createdAt.toISOString(),
        summary: r.summary,
        transcript: r.transcript,
      });
    }
  }

  // ── Outbound (table campaign_calls + nom du contact) ────────────────
  if (direction !== "inbound") {
    const conds = [eq(campaignCalls.userId, userId)];
    if (from) conds.push(gte(campaignCalls.createdAt, from));
    if (to) conds.push(lte(campaignCalls.createdAt, to));
    const rows = await db
      .select({
        id: campaignCalls.id,
        phoneNumber: campaignCalls.phoneNumber,
        summary: campaignCalls.summary,
        transcript: campaignCalls.transcript,
        durationSeconds: campaignCalls.durationSeconds,
        createdAt: campaignCalls.createdAt,
        disposition: campaignCalls.disposition,
        contactName: campaignContacts.contactName,
      })
      .from(campaignCalls)
      .innerJoin(
        campaignContacts,
        eq(campaignCalls.contactId, campaignContacts.id),
      )
      .where(and(...conds))
      .orderBy(desc(campaignCalls.createdAt))
      .limit(MAX_FETCH);
    for (const r of rows) {
      if (!phoneMatches(r.phoneNumber)) continue;
      items.push({
        id: r.id,
        direction: "outbound",
        subject: deriveSubject(r.summary, r.transcript),
        name: r.contactName || null,
        phone: r.phoneNumber,
        language,
        durationSeconds: r.durationSeconds,
        date: r.createdAt.toISOString(),
        summary: r.summary,
        transcript: r.transcript,
      });
    }
  }

  // ── Filtre sujet (dérivé) + tri + pagination ────────────────────────
  const filtered = subject ? items.filter((i) => i.subject === subject) : items;
  filtered.sort((a, b) =>
    order === "asc"
      ? a.date.localeCompare(b.date)
      : b.date.localeCompare(a.date),
  );
  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);

  return NextResponse.json({
    phone: phoneParam,
    count: total,
    limit,
    offset,
    items: page,
  });
}
