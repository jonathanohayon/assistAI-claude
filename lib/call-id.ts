// Call id = the LiveKit room name of the call, sent by the worker with every
// web request of that call (header x-call-id) and in its own events
// (metadata.callId). Lets the web tie tool events to THEIR call even when a
// busy salon has overlapping calls.

const CALL_ID_RE = /^[A-Za-z0-9_\-.:+]{1,128}$/;

/** Validated call id, or null (absent / malformed → treated as unknown). */
export function parseCallId(raw: unknown): string | null {
  return typeof raw === "string" && CALL_ID_RE.test(raw) ? raw : null;
}

export function callIdFromRequest(req: { headers: { get(name: string): string | null } }): string | null {
  return parseCallId(req.headers.get("x-call-id"));
}

/** `{ callId }` when the request carries one, else `{}` — spread into event metadata. */
export function callIdMeta(req: { headers: { get(name: string): string | null } }): { callId?: string } {
  const id = callIdFromRequest(req);
  return id ? { callId: id } : {};
}
