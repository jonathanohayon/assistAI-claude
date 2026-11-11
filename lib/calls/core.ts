// Tenant Calls page — pure helpers (no DB, no network). lib/calls/query.ts
// feeds them rows; the tests feed them mock rows.
//
// ── THE JOIN RULE (which events belong to which call) ───────────────────
// Events carry metadata.callId, but not always the same id:
//   1. Tool events (calendar book/cancel/reschedule _success via x-call-id,
//      the worker's call_transfer / call_started via remoteLog) carry the
//      WORKER's call id: the raw LiveKit room name for workers before
//      2026-11-05, sha256(room name) first 16 hex chars since then
//      (worker src/session-context.ts callIdFromRoomName). calls.call_id holds
//      what the worker sent with /api/calls/end, i.e. the same form.
//   2. Events written inside /api/calls/end (call_received,
//      summary_generated, whatsapp_*, call_log_added) carry calls.id (uuid).
//   3. Rows from workers that sent no id have calls.call_id = '' and their
//      tool events are unstamped.
// So a call's keys are { calls.id, calls.call_id, sha16(calls.call_id) }
// (the hash of a raw room name covers a raw row whose events are hashed);
// a STAMPED event belongs to the call holding its id among those keys, and
// to no other call. An UNSTAMPED tool event is attached only to a call with
// call_id '' (old worker) whose time span contains it
// (end - duration - 30 s … end + 5 s, as lib/call-type-db.ts), the earliest
// ending one if several overlap. A call that has an id never takes
// unstamped events. Every event and call is of the same tenant (user_id),
// checked here again on top of the SQL scope.

import { createHash } from "node:crypto";

import { callTypeFromEvents, type CallType } from "@/lib/call-type";
import type {
  CallAction,
  CallFigures,
  CallLine,
  CallOutcome,
  CallTranscriptTurn,
  TextDirection,
} from "@/lib/calls/contract";

export const TOOL_EVENTS = ["book_success", "cancel_success", "reschedule_success", "call_transfer"] as const;
export const RECAP_EVENTS = [
  "whatsapp_sent_client",
  "whatsapp_sent_owner",
  "whatsapp_undelivered_client",
  "whatsapp_undelivered_owner",
  "whatsapp_failed_client",
  "whatsapp_failed_owner",
] as const;
/** Every event name the Calls page reads (actions + outcome). */
export const CALL_PAGE_EVENTS: readonly string[] = [...TOOL_EVENTS, ...RECAP_EVENTS];

const WINDOW_BEFORE_MS = 30_000;
const WINDOW_AFTER_MS = 5_000;

/** Worker call id of a room name (worker src/session-context.ts callIdFromRoomName). */
export function hashCallId(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 16);
}

export interface JoinCall {
  id: string;
  userId: string;
  /** calls.call_id ('' = old worker). */
  callId: string;
  /** calls.created_at = end of the call. */
  createdAt: Date;
  durationSeconds: number;
}

export interface JoinEvent {
  id: string;
  userId: string | null;
  event: string;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
}

/** All ids under which a call's events can be stamped. */
export function callKeys(c: Pick<JoinCall, "id" | "callId">): string[] {
  const keys = [c.id];
  if (c.callId) keys.push(c.callId, hashCallId(c.callId));
  return keys;
}

function stampOf(e: JoinEvent): string | null {
  const v = e.metadata?.["callId"];
  return typeof v === "string" && v ? v : null;
}

/** calls.id → its events (createdAt ascending). See THE JOIN RULE above. */
export function attachEvents(calls: JoinCall[], events: JoinEvent[]): Map<string, JoinEvent[]> {
  const out = new Map<string, JoinEvent[]>(calls.map((c) => [c.id, []]));
  const byKey = new Map<string, JoinCall>();
  for (const c of calls) for (const k of callKeys(c)) if (!byKey.has(k)) byKey.set(k, c);
  const legacy = calls
    .filter((c) => !c.callId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const tool = new Set<string>(TOOL_EVENTS);

  for (const e of events) {
    const stamp = stampOf(e);
    let owner: JoinCall | undefined;
    if (stamp) {
      owner = byKey.get(stamp);
    } else if (tool.has(e.event)) {
      const t = e.createdAt.getTime();
      owner = legacy.find((c) => {
        if (c.userId !== e.userId) return false;
        const end = c.createdAt.getTime();
        const start = end - Math.max(0, c.durationSeconds) * 1000 - WINDOW_BEFORE_MS;
        return t >= start && t <= end + WINDOW_AFTER_MS;
      });
    }
    if (!owner || owner.userId !== e.userId) continue;
    out.get(owner.id)!.push(e);
  }
  for (const list of out.values()) list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return out;
}

const OUTCOME_OF: Record<CallType, CallOutcome> = {
  Annulation: "cancelled",
  Modification: "rescheduled",
  RDV: "booked",
  Transfert: "transferred",
  Message: "conversation",
  Info: "conversation",
};

/**
 * Outcome from the call's tool events only (lib/call-type.ts
 * callTypeFromEvents — its pure, keyword-free part): cancelled > rescheduled
 * > booked > transferred (ok=true) > conversation.
 */
export function outcomeFromEvents(events: Array<Pick<JoinEvent, "event" | "metadata">>): CallOutcome {
  const t = callTypeFromEvents(events);
  return t ? OUTCOME_OF[t] : "conversation";
}

/** Figures over the listed calls of the period (each call counted once). */
export function figuresFor(callIds: string[], attached: Map<string, JoinEvent[]>): CallFigures {
  let booked = 0;
  let transferred = 0;
  for (const id of callIds) {
    const evs = attached.get(id) ?? [];
    if (evs.some((e) => e.event === "book_success")) booked++;
    if (evs.some((e) => e.event === "call_transfer" && e.metadata?.["ok"] === true)) transferred++;
  }
  return { callsReceived: callIds.length, booked, transferred };
}

/** null when 0 / missing / not a positive number — never 0. */
export function durationOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// ── Transcript ──────────────────────────────────────────────────────────
// Only writer: /api/calls/end stores the worker's [{ role: "user" |
// "assistant", text }] (default '[]'). Anything else is reported raw.

const ROLE_OF: Record<string, CallTranscriptTurn["role"]> = { user: "caller", assistant: "agent" };
const RAW_CAP = 20_000;

export function readTranscript(stored: unknown): { turns: CallTranscriptTurn[]; raw: string | null } {
  const unreadable = () => {
    let raw: string | null = null;
    try {
      raw = stored == null ? null : JSON.stringify(stored).slice(0, RAW_CAP);
    } catch {
      raw = null;
    }
    return { turns: [], raw };
  };
  if (!Array.isArray(stored)) return unreadable();
  const turns: CallTranscriptTurn[] = [];
  for (const t of stored) {
    if (!t || typeof t !== "object") return unreadable();
    const { role, text } = t as { role?: unknown; text?: unknown };
    const mapped = typeof role === "string" ? ROLE_OF[role] : undefined;
    if (!mapped || (text != null && typeof text !== "string")) return unreadable();
    const clean = (text ?? "").trim();
    if (clean) turns.push({ role: mapped, text: clean });
  }
  return { turns, raw: null };
}

/** Texts of a stored transcript, whatever its shape (for direction / hasTranscript). */
function transcriptTexts(stored: unknown): string[] {
  if (!Array.isArray(stored)) return [];
  return stored
    .map((t) => (t && typeof t === "object" ? (t as { text?: unknown }).text : null))
    .filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

const HEBREW = /[֐-׿יִ-ﭏ]/u;
const LETTER = /\p{L}/u;

/** rtl when Hebrew-script letters are the majority of the letters of the text. */
export function textDirection(texts: string[]): TextDirection {
  let letters = 0;
  let hebrew = 0;
  for (const s of texts) {
    for (const ch of s) {
      if (!LETTER.test(ch)) continue;
      letters++;
      if (HEBREW.test(ch)) hebrew++;
    }
  }
  return letters > 0 && hebrew * 2 > letters ? "rtl" : "ltr";
}

// ── Lines and actions ───────────────────────────────────────────────────

export interface CallRow {
  id: string;
  createdAt: Date;
  fromNumber: string;
  toNumber: string;
  summary: string;
  transcript: unknown;
  durationSeconds: number;
}

export function toLine(row: CallRow, events: JoinEvent[], contactName: string | null): CallLine {
  const texts = transcriptTexts(row.transcript);
  const summary = (row.summary ?? "").trim();
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    fromNumber: row.fromNumber ?? "",
    toNumber: row.toNumber ?? "",
    contactName: contactName && contactName.trim() ? contactName.trim() : null,
    outcome: outcomeFromEvents(events),
    durationSeconds: durationOrNull(row.durationSeconds),
    hasTranscript: texts.length > 0,
    hasSummary: summary !== "",
    direction: textDirection(summary ? [summary, ...texts] : texts),
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const str = (v: unknown, re: RegExp) => (typeof v === "string" && re.test(v) ? v : null);

/**
 * Plain facts from a call's events. Only whitelisted, formatted fields are
 * copied (date / time / ok / recipient / status): never raw metadata, ids,
 * phone numbers, names or error texts.
 */
export function toActions(events: JoinEvent[]): CallAction[] {
  const undeliveredSids = new Set<string>();
  for (const e of events) {
    if (e.event.startsWith("whatsapp_undelivered_")) {
      const sid = e.metadata?.["sid"];
      if (typeof sid === "string") undeliveredSids.add(sid);
    }
  }
  const out: CallAction[] = [];
  for (const e of events) {
    const at = e.createdAt.toISOString();
    const m = e.metadata ?? {};
    switch (e.event) {
      case "book_success":
        out.push({ at, kind: "booked", date: str(m["date"], DATE_RE), time: str(m["time"], TIME_RE) });
        break;
      case "cancel_success":
        out.push({ at, kind: "cancelled" });
        break;
      case "reschedule_success":
        out.push({ at, kind: "rescheduled", date: str(m["newDate"], DATE_RE), time: str(m["newTime"], TIME_RE) });
        break;
      case "call_transfer":
        out.push({ at, kind: "transferred", ok: m["ok"] === true });
        break;
      case "whatsapp_sent_client":
      case "whatsapp_sent_owner": {
        const sid = m["sid"];
        out.push({
          at,
          kind: "whatsapp_recap",
          recipient: e.event.endsWith("_client") ? "caller" : "owner",
          status: typeof sid === "string" && undeliveredSids.has(sid) ? "undelivered" : "sent",
        });
        break;
      }
      case "whatsapp_failed_client":
      case "whatsapp_failed_owner":
        out.push({ at, kind: "whatsapp_recap", recipient: e.event.endsWith("_client") ? "caller" : "owner", status: "failed" });
        break;
      // whatsapp_undelivered_* only marks the matching "sent" above.
    }
  }
  return out;
}

// ── Period and cursor ───────────────────────────────────────────────────

export const DEFAULT_PERIOD_DAYS = 30;
export const MAX_PERIOD_DAYS = 366;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
const DAY_MS = 86_400_000;

export interface Period {
  since: Date;
  until: Date;
}

function parseIso(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ?since / ?until → period (default: last 30 days up to now). null = invalid. */
export function parsePeriod(since: string | null, until: string | null, now = new Date()): Period | null {
  const u = until ? parseIso(until) : now;
  if (!u) return null;
  const s = since ? parseIso(since) : new Date(u.getTime() - DEFAULT_PERIOD_DAYS * DAY_MS);
  if (!s) return null;
  if (s.getTime() >= u.getTime()) return null;
  if (u.getTime() - s.getTime() > MAX_PERIOD_DAYS * DAY_MS) return null;
  return { since: s, until: u };
}

export function parseLimit(v: string | null): number {
  const n = Math.floor(Number(v));
  if (!v || !Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/** Keyset position: created_at as Postgres text with microseconds (a JS Date would lose them) + id. */
export interface Cursor {
  period: Period;
  createdAt: string;
  id: string;
  /** The ?outcome= filter of the first page; absent = unfiltered list. */
  outcome?: CallOutcome;
}

export const CALL_OUTCOMES: readonly CallOutcome[] = ["booked", "cancelled", "rescheduled", "transferred", "conversation"];

const isOutcome = (v: string): v is CallOutcome => (CALL_OUTCOMES as readonly string[]).includes(v);

/**
 * ?outcome= → the filter. null param (absent) = no filter; any value that is
 * not exactly one CallOutcome (including "") is an error.
 */
export function parseOutcome(v: string | null): { outcome: CallOutcome | null } | { error: "invalid_outcome" } {
  if (v === null) return { outcome: null };
  return isOutcome(v) ? { outcome: v } : { error: "invalid_outcome" };
}

/**
 * The filter applied to a request: a cursor carries its own filter (later
 * pages need only ?cursor=); an explicit ?outcome= must then be the same
 * value, and a cursor without a filter cannot be reused with one.
 */
export function outcomeForRequest(
  requested: CallOutcome | null,
  cursor: Cursor | null,
): { outcome: CallOutcome | null } | { error: "invalid_cursor" } {
  if (!cursor) return { outcome: requested };
  const carried = cursor.outcome ?? null;
  if (requested !== null && requested !== carried) return { error: "invalid_cursor" };
  return { outcome: carried };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PG_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export const isUuid = (v: string) => UUID_RE.test(v);

// Unfiltered cursor: 4 fields (unchanged format). Filtered: a 5th field, the outcome.
export function encodeCursor(c: Cursor): string {
  const parts = [c.period.since.toISOString(), c.period.until.toISOString(), c.createdAt, c.id];
  if (c.outcome) parts.push(c.outcome);
  return Buffer.from(parts.join("|"), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor | null {
  let parts: string[];
  try {
    parts = Buffer.from(raw, "base64url").toString("utf8").split("|");
  } catch {
    return null;
  }
  if (parts.length !== 4 && parts.length !== 5) return null;
  const [s, u, createdAt, id, outcome] = parts;
  const period = parsePeriod(s, u);
  if (!period || !PG_TS_RE.test(createdAt) || !isUuid(id)) return null;
  if (outcome === undefined) return { period, createdAt, id };
  return isOutcome(outcome) ? { period, createdAt, id, outcome } : null;
}

/** Keyset order of the list: created_at desc, id desc (Postgres cursor text + lowercase uuid). */
export function keysetBefore(a: { cursorTs: string; id: string }, b: { createdAt: string; id: string }): boolean {
  if (a.cursorTs !== b.createdAt) return a.cursorTs < b.createdAt;
  return a.id.toLowerCase() < b.id.toLowerCase();
}

/**
 * Filtered page over the period's listed calls (any order in): keep the
 * calls whose outcome is `outcome`, sort newest first, start after the
 * cursor, take limit + 1 to know whether a next page exists.
 */
export function filteredPage<T extends { id: string; cursorTs: string }>(
  calls: T[],
  outcomeOf: (id: string) => CallOutcome,
  outcome: CallOutcome,
  cursor: Pick<Cursor, "createdAt" | "id"> | null,
  limit: number,
): { rows: T[]; hasMore: boolean } {
  const sorted = calls
    .filter((c) => outcomeOf(c.id) === outcome)
    .filter((c) => !cursor || keysetBefore(c, cursor))
    .sort((a, b) => (keysetBefore(a, { createdAt: b.cursorTs, id: b.id }) ? 1 : keysetBefore(b, { createdAt: a.cursorTs, id: a.id }) ? -1 : 0));
  return { rows: sorted.slice(0, limit), hasMore: sorted.length > limit };
}
