/**
 * Logique de requête des transcripts — PARTAGÉE entre l'API publique v1
 * (app/api/v1/transcripts) et la preview admin (app/api/admin/transcripts-preview)
 * pour que l'admin voie EXACTEMENT ce que l'API renvoie.
 */
import { and, desc, eq, gte, lte } from "drizzle-orm";

import { type CallSubject, deriveSubject } from "@/lib/call-subject";
import { db } from "@/lib/db";
import {
  agentConfigs,
  calls,
  campaignCalls,
  campaignContacts,
} from "@/lib/db/schema";
import { normalizePhoneForDedup } from "@/lib/phone-utils";

const MAX_FETCH = 2000; // borne de sécurité (un seul numéro → volume faible)

export type TranscriptItem = {
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

export interface TranscriptQueryOptions {
  phone: string;
  direction: "all" | "inbound" | "outbound";
  subject: CallSubject | null;
  from: Date | null;
  to: Date | null;
  order: "asc" | "desc";
  limit: number;
  offset: number;
}

export async function queryTranscripts(
  userId: string,
  opts: TranscriptQueryOptions,
): Promise<{ count: number; items: TranscriptItem[] }> {
  const phoneDigits = normalizePhoneForDedup(opts.phone);
  // Match tolérant au format/indicatif (+972XXX vs 0XXX) à partir de 7 chiffres.
  const phoneMatches = (stored: string): boolean => {
    const a = normalizePhoneForDedup(stored);
    if (!a) return false;
    if (a === phoneDigits) return true;
    const min = Math.min(a.length, phoneDigits.length);
    return min >= 7 && (a.endsWith(phoneDigits) || phoneDigits.endsWith(a));
  };

  const [cfg] = await db
    .select({ language: agentConfigs.primaryLanguage })
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId))
    .limit(1);
  const language = cfg?.language ?? "fr";

  const items: TranscriptItem[] = [];

  if (opts.direction !== "outbound") {
    const conds = [eq(calls.userId, userId)];
    if (opts.from) conds.push(gte(calls.createdAt, opts.from));
    if (opts.to) conds.push(lte(calls.createdAt, opts.to));
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
        name: null,
        phone: r.fromNumber,
        language,
        durationSeconds: r.durationSeconds,
        date: r.createdAt.toISOString(),
        summary: r.summary,
        transcript: r.transcript,
      });
    }
  }

  if (opts.direction !== "inbound") {
    const conds = [eq(campaignCalls.userId, userId)];
    if (opts.from) conds.push(gte(campaignCalls.createdAt, opts.from));
    if (opts.to) conds.push(lte(campaignCalls.createdAt, opts.to));
    const rows = await db
      .select({
        id: campaignCalls.id,
        phoneNumber: campaignCalls.phoneNumber,
        summary: campaignCalls.summary,
        transcript: campaignCalls.transcript,
        durationSeconds: campaignCalls.durationSeconds,
        createdAt: campaignCalls.createdAt,
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

  const filtered = opts.subject
    ? items.filter((i) => i.subject === opts.subject)
    : items;
  filtered.sort((a, b) =>
    opts.order === "asc"
      ? a.date.localeCompare(b.date)
      : b.date.localeCompare(a.date),
  );
  return {
    count: filtered.length,
    items: filtered.slice(opts.offset, opts.offset + opts.limit),
  };
}
