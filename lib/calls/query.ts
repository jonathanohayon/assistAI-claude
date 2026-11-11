// Tenant Calls page — SERVER-ONLY reads. Read-only: SELECTs only, no LLM,
// no network. Every query is scoped to one tenant (user_id). The join of
// events to calls is decided in lib/calls/core.ts (THE JOIN RULE).
//
// ── Which calls are listed (inbound only) ───────────────────────────────
// Only /api/calls/end inserts into calls. What reaches it (worker agent.ts
// post-call, origin/main): inbound SIP/WhatsApp calls, AND the web LiveTest
// (origin "web", room `livetest-<userId>-…`), AND today the "call me"
// call-back (room `callme__<userId>__…`; the worker on main has no call_me
// origin yet and sees it as SIP — worker PR #33 stops posting it). Campaign
// calls (room `campaign__…`) go to /api/agent/campaign-result and agent live
// tests (origin outbound_test) post nothing, but old rows are excluded too.
// A call is NOT listed when any of:
//   a. calls.call_id is a raw room name starting livetest- / callme__ /
//      campaign__ (rows from workers before the 2026-11-05 hash);
//   b. the worker's call_started event stamped with the call's id (raw or
//      hashed) has that room-name prefix or origin.kind web / campaign /
//      outbound_test / call_me (hashed rows: the hash hides the room name);
//   c. its call_received event (stamped with calls.id) records an empty
//      toNumber: posted without a dialled line = web session (LiveTest, or
//      an origin the worker could not detect).

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import type { CallDetailResponse, CallListResponse } from "@/lib/calls/contract";
import {
  attachEvents,
  CALL_PAGE_EVENTS,
  encodeCursor,
  figuresFor,
  readTranscript,
  toActions,
  toLine,
  type CallRow,
  type Cursor,
  type JoinCall,
  type JoinEvent,
  type Period,
} from "@/lib/calls/core";

const OUTBOUND_ROOM_RE = "^(livetest-|callme__|campaign__)";
const NON_INBOUND_KINDS = sql`('web', 'campaign', 'outbound_test', 'call_me')`;

/** SQL: hash of calls.call_id as the worker computes it (sha256, 16 hex). */
const callHash = (alias: string) =>
  sql.raw(`left(encode(sha256(convert_to(${alias}.call_id, 'UTF8')), 'hex'), 16)`);

/** SQL predicate: the call row `c` is an inbound call (see header). */
export function inboundPredicate(): SQL {
  return sql`(
    c.call_id !~ ${OUTBOUND_ROOM_RE}
    AND NOT (c.call_id <> '' AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.user_id = c.user_id AND e.event = 'call_started'
        AND e.metadata ? 'callId'
        AND (e.metadata->>'callId') IN (c.call_id, ${callHash("c")})
        AND (coalesce(e.metadata->>'roomName', '') ~ ${OUTBOUND_ROOM_RE}
             OR (e.metadata->'origin'->>'kind') IN ${NON_INBOUND_KINDS})
    ))
    AND NOT EXISTS (
      SELECT 1 FROM events e
      WHERE e.user_id = c.user_id AND e.event = 'call_received'
        AND e.metadata ? 'callId'
        AND (e.metadata->>'callId') = c.id::text
        AND e.metadata ? 'toNumber' AND (e.metadata->>'toNumber') = ''
    )
  )`;
}

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? r : ((r as { rows?: Row[] }).rows ?? [])) as Row[];

const toJoinCall = (r: Row, userId: string): JoinCall => ({
  id: String(r.id),
  userId,
  callId: String(r.call_id ?? ""),
  createdAt: new Date(r.created_at as string),
  durationSeconds: Number(r.duration_seconds ?? 0) || 0,
});

const toCallRow = (r: Row): CallRow => ({
  id: String(r.id),
  createdAt: new Date(r.created_at as string),
  fromNumber: String(r.from_number ?? ""),
  toNumber: String(r.to_number ?? ""),
  summary: String(r.summary ?? ""),
  transcript: r.transcript,
  durationSeconds: Number(r.duration_seconds ?? 0) || 0,
});

const LOOKBACK_MIN_MS = 3_600_000; // stamped events happen during the call (≤ 1 h before its end if duration unknown)
const LOOKAHEAD_MS = 15 * 60_000; // post-call events (summary, WhatsApp, delivery check) follow within minutes

/** The tenant's candidate events around these calls; attachEvents decides. */
export async function loadEventsFor(userId: string, calls: JoinCall[], names: readonly string[] = CALL_PAGE_EVENTS) {
  if (calls.length === 0) return new Map<string, JoinEvent[]>();
  const maxDur = Math.max(...calls.map((c) => c.durationSeconds)) * 1000;
  const from = new Date(Math.min(...calls.map((c) => c.createdAt.getTime())) - Math.max(maxDur + 60_000, LOOKBACK_MIN_MS));
  const to = new Date(Math.max(...calls.map((c) => c.createdAt.getTime())) + LOOKAHEAD_MS);
  const res = await db.execute(sql`
    SELECT id, user_id, event, created_at, metadata FROM events
    WHERE user_id = ${userId}
      AND event IN (${sql.join(names.map((n) => sql`${n}`), sql`, `)})
      AND created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
  `);
  const evs: JoinEvent[] = rowsOf(res).map((r) => ({
    id: String(r.id),
    userId: r.user_id == null ? null : String(r.user_id),
    event: String(r.event),
    createdAt: new Date(r.created_at as string),
    metadata: (r.metadata ?? null) as Record<string, unknown> | null,
  }));
  return attachEvents(calls, evs);
}

/** Latest non-empty client name per phone, for this tenant (client_visits). */
async function contactNames(userId: string, phones: string[]): Promise<Map<string, string>> {
  const list = [...new Set(phones.filter(Boolean))];
  if (list.length === 0) return new Map();
  const res = await db.execute(sql`
    SELECT client_phone,
      (array_agg(client_name ORDER BY starts_at DESC) FILTER (WHERE client_name <> ''))[1] AS name
    FROM client_visits
    WHERE user_id = ${userId} AND client_phone IN (${sql.join(list.map((p) => sql`${p}`), sql`, `)})
    GROUP BY client_phone
  `);
  const out = new Map<string, string>();
  for (const r of rowsOf(res)) if (r.name) out.set(String(r.client_phone), String(r.name));
  return out;
}

async function accountLanguage(userId: string): Promise<string> {
  const res = await db.execute(sql`SELECT primary_language FROM agent_configs WHERE user_id = ${userId} LIMIT 1`);
  const v = rowsOf(res)[0]?.primary_language;
  return typeof v === "string" && v ? v : "fr";
}

const CURSOR_TS = sql.raw(`to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

export async function listCalls(opts: {
  userId: string;
  period: Period;
  limit: number;
  cursor: Cursor | null;
}): Promise<CallListResponse> {
  const { userId, period, limit, cursor } = opts;
  const scope = sql`c.user_id = ${userId}
    AND c.created_at >= ${period.since.toISOString()} AND c.created_at < ${period.until.toISOString()}
    AND ${inboundPredicate()}`;

  const pageRes = await db.execute(sql`
    SELECT c.id, c.created_at, ${CURSOR_TS} AS cursor_ts, c.from_number, c.to_number, c.summary, c.transcript,
           c.duration_seconds, c.call_id
    FROM calls c
    WHERE ${scope}
      ${cursor ? sql`AND (c.created_at, c.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : sql``}
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ${limit + 1}
  `);
  const page = rowsOf(pageRes);
  const hasMore = page.length > limit;
  const rows = page.slice(0, limit);

  // Every listed call of the period: the figures cover the period, not the
  // page, and the join runs once over the whole set so a page shows exactly
  // what the figures counted.
  const allRes = await db.execute(sql`
    SELECT c.id, c.call_id, c.created_at, c.duration_seconds FROM calls c WHERE ${scope}
  `);
  const all = rowsOf(allRes).map((r) => toJoinCall(r, userId));
  const pageEvents = await loadEventsFor(userId, all);
  const figures = figuresFor(all.map((c) => c.id), pageEvents);
  const names = await contactNames(userId, rows.map((r) => String(r.from_number ?? "")));

  const last = rows[rows.length - 1];
  return {
    items: rows.map((r) => {
      const row = toCallRow(r);
      return toLine(row, pageEvents.get(row.id) ?? [], names.get(row.fromNumber) ?? null);
    }),
    nextCursor:
      hasMore && last ? encodeCursor({ period, createdAt: String(last.cursor_ts), id: String(last.id) }) : null,
    period: { since: period.since.toISOString(), until: period.until.toISOString() },
    figures,
    accountLanguage: await accountLanguage(userId),
  };
}

/** One inbound call of this tenant, or null (not found / other tenant / outbound). */
export async function getCallDetail(userId: string, id: string): Promise<CallDetailResponse | null> {
  const res = await db.execute(sql`
    SELECT c.id, c.created_at, c.from_number, c.to_number, c.summary, c.transcript, c.duration_seconds, c.call_id
    FROM calls c
    WHERE c.id = ${id}::uuid AND c.user_id = ${userId} AND ${inboundPredicate()}
    LIMIT 1
  `);
  const r = rowsOf(res)[0];
  if (!r) return null;
  const row = toCallRow(r);
  // Neighbouring listed calls take part in the join, so an unstamped event of
  // an old overlapping call lands where the list puts it.
  const nearRes = await db.execute(sql`
    SELECT c.id, c.call_id, c.created_at, c.duration_seconds FROM calls c
    WHERE c.user_id = ${userId} AND ${inboundPredicate()}
      AND c.created_at BETWEEN ${row.createdAt.toISOString()}::timestamptz - interval '3 hours'
                          AND ${row.createdAt.toISOString()}::timestamptz + interval '3 hours'
  `);
  const near = rowsOf(nearRes).map((x) => toJoinCall(x, userId));
  if (!near.some((c) => c.id === row.id)) near.push(toJoinCall(r, userId));
  const evs = (await loadEventsFor(userId, near)).get(row.id) ?? [];
  const names = await contactNames(userId, [row.fromNumber]);
  const { turns, raw } = readTranscript(row.transcript);
  const summary = row.summary.trim();
  return {
    ...toLine(row, evs, names.get(row.fromNumber) ?? null),
    summary: summary || null,
    transcript: turns,
    transcriptRaw: raw,
    actions: toActions(evs),
  };
}
