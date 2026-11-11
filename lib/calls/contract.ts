// Tenant Calls page — response contract of
//   GET /api/dashboard/calls        (list + period figures)
//   GET /api/dashboard/calls/[id]   (one call)
// The front reads these types; the routes build exactly these shapes.
//
// Facts only: the outcome and the figures come from the tool events the call
// produced (calendar book/cancel/reschedule, worker transfer) — never from
// keywords in the summary, never from calls.call_type. The routes make no LLM
// call, no network call and no write.

/** What the call provably did. "conversation" = no decisive tool event. */
export type CallOutcome = "booked" | "cancelled" | "rescheduled" | "transferred" | "conversation";

/**
 * Text direction of the call, computed from its own text (summary +
 * transcript): "rtl" when Hebrew-script letters are the majority of the
 * letters, else "ltr" (also "ltr" when there is no text). Not a language:
 * the language of a call is not stored.
 */
export type TextDirection = "rtl" | "ltr";

/** One line of the list (also the head of the detail). */
export interface CallLine {
  /** calls.id (uuid) — the id of GET /api/dashboard/calls/[id]. */
  id: string;
  /** ISO 8601, end of the call (when the web recorded it). */
  createdAt: string;
  /** Caller number as received (E.164 for phone calls); "" when hidden/unknown. */
  fromNumber: string;
  /** Best-effort: latest non-empty name booked under this number for this tenant (client_visits); else null. */
  contactName: string | null;
  outcome: CallOutcome;
  /** Seconds; null when unknown (0 or missing) — never 0. */
  durationSeconds: number | null;
  /** At least one non-empty transcript turn. */
  hasTranscript: boolean;
  /** A non-empty summary exists. */
  hasSummary: boolean;
  direction: TextDirection;
}

/** The three figures of the period (inbound listed calls only). */
export interface CallFigures {
  /** Number of listed calls in the period. */
  callsReceived: number;
  /** Listed calls with at least one proven booking (book_success). */
  booked: number;
  /** Listed calls with at least one successful transfer (call_transfer ok=true). */
  transferred: number;
}

/** The period actually used (ISO 8601), echoed back. since inclusive, until exclusive. */
export interface CallPeriod {
  since: string;
  until: string;
}

/**
 * GET /api/dashboard/calls[?since&until&cursor&limit&asUserId]
 * - Period: ?since / ?until (ISO 8601). Default: the last 30 days up to now.
 *   At most 366 days. Bad values → 400 { error: "invalid_period" }.
 * - Order: newest first (created_at desc, id desc). limit default 50, max 100.
 * - nextCursor: opaque; pass it back as ?cursor= for the next page. It carries
 *   the period, so the next page keeps the same period (since/until are then
 *   ignored). Bad cursor → 400 { error: "invalid_cursor" }.
 * - figures: computed over exactly `period` (all pages), not over the page.
 */
export interface CallListResponse {
  items: CallLine[];
  nextCursor: string | null;
  period: CallPeriod;
  figures: CallFigures;
  /** The account's primary language (agent config), e.g. "fr" | "he" | "en". */
  accountLanguage: string;
}

export interface CallTranscriptTurn {
  role: "caller" | "agent";
  text: string;
}

/** A plain fact of what happened during / after the call, oldest first. */
export type CallAction =
  | { at: string; kind: "booked"; date: string | null; time: string | null }
  | { at: string; kind: "cancelled" }
  | { at: string; kind: "rescheduled"; date: string | null; time: string | null }
  | { at: string; kind: "transferred"; ok: boolean }
  | {
      at: string;
      kind: "whatsapp_recap";
      recipient: "caller" | "owner";
      /** "sent" = accepted by the provider; "undelivered" = reported not delivered later; "failed" = refused at send. */
      status: "sent" | "undelivered" | "failed";
    };

/**
 * GET /api/dashboard/calls/[id][?asUserId]
 * 404 { error: "not_found" } when the call is not this tenant's, is an
 * outbound / test call, or the id is not a uuid.
 */
export interface CallDetailResponse extends CallLine {
  summary: string | null;
  /** Turns with empty text dropped. [] when the stored transcript is unreadable (see transcriptRaw). */
  transcript: CallTranscriptTurn[];
  /** ONLY when the stored transcript has an unexpected shape: its JSON (capped), else null. */
  transcriptRaw: string | null;
  actions: CallAction[];
}
