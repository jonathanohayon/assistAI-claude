// Parsing of the worker's POST /api/calls/end body, kept pure so it is
// unit-tested (scripts/tests/call-end-body.test.ts).

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
  };
}
