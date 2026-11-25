// Parsing of the worker's POST /api/calls/end body, kept pure so it is
// unit-tested (scripts/tests/call-end-body.test.ts).

import { parseCallId } from "./call-id";
import { productForCall } from "./call-product";

export type TranscriptEntry = { role: "user" | "assistant"; text: string };

export interface CallEndInput {
  fromNumber: string;
  /** Dialed number (SIP path); routes the call to its tenant. */
  toNumber: string;
  /** Web LiveTest path: tenant user id, takes priority over toNumber. */
  userId: string;
  /** 'whatsapp': the 24h service window is open, so the client recap is sent
   *  free-form in the same thread instead of a template. */
  channel: "pstn" | "whatsapp";
  transcript: TranscriptEntry[];
  durationSeconds: number;
  /** Engine that took the call and its model (worker >= 2026-11-03), else null. */
  realtimeProvider: "openai" | "gemini" | "xai" | null;
  realtimeModel: string | null;
  /** LiveKit room name (lib/call-id.ts); null for older workers. */
  callId: string | null;
  /**
   * B3, optional (worker >= B3): whether the client's agent was actually
   * reached during the call. Strict: a boolean, else null (absent, or any
   * other type: never an error).
   */
  clientAgentReached: boolean | null;
  /**
   * B3, optional: the signed connector route token session-config served,
   * echoed back as received (verified later, lib/connectors/call-attribution.ts).
   * undefined when absent.
   */
  connectorRoute: unknown;
}

export function parseCallEndBody(raw: unknown): CallEndInput {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    fromNumber: str(b.fromNumber),
    toNumber: str(b.toNumber),
    userId: str(b.userId),
    channel: b.channel === "whatsapp" ? "whatsapp" : "pstn",
    transcript: Array.isArray(b.transcript) ? (b.transcript as TranscriptEntry[]) : [],
    // Persisted for billing usage charts: integer >= 0, 0 when missing/invalid.
    durationSeconds: Math.max(0, Math.round(Number(b.durationSeconds)) || 0),
    realtimeProvider:
      b.realtimeProvider === "openai" || b.realtimeProvider === "gemini" || b.realtimeProvider === "xai"
        ? b.realtimeProvider
        : null,
    realtimeModel: str(b.realtimeModel).slice(0, 80) || null,
    callId: parseCallId(b.callId),
    clientAgentReached: typeof b.clientAgentReached === "boolean" ? b.clientAgentReached : null,
    connectorRoute: b.connectorRoute,
  };
}

/** Values of the calls row inserted at call end. `toNumber` is stored as
 *  parsed (trimmed, not otherwise normalised), exactly like `fromNumber`;
 *  '' when the worker sent none (web LiveTest, older workers). */
export function callInsertValues(input: CallEndInput, userId: string, callId: string | null) {
  return {
    userId,
    fromNumber: input.fromNumber,
    toNumber: input.toNumber,
    transcript: input.transcript,
    summary: "",
    durationSeconds: input.durationSeconds,
    realtimeProvider: input.realtimeProvider,
    realtimeModel: input.realtimeModel,
    callId: callId ?? "",
    // Only the channel today (lib/call-product.ts): NULL = reception.
    product: productForCall({ channel: input.channel }),
    // B3: only when the worker reported it; absent = the column's NULL default
    // (the inserted values are then exactly today's).
    ...(input.clientAgentReached !== null ? { clientAgentReached: input.clientAgentReached } : {}),
  };
}
