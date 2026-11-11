// Outbound call identity (T4). On an OUTBOUND call the phone number the
// worker knows is OUR caller id, which may be the trunk's default number —
// another account's, or nobody's. So a tool request marked outbound is
// routed by the account id ONLY (x-tenant-user-id); its x-tenant-phone is
// ignored, and without an account id the request is refused.
//
// The worker (T4c) sends `x-call-direction: outbound` together with
// `x-tenant-user-id` on every tool request of an outbound call. Without the
// marker (or with any other value) nothing changes: inbound routing stays
// exactly as before.
export const CALL_DIRECTION_HEADER = "x-call-direction";

export function isOutboundCall(headers: Headers): boolean {
  return (headers.get(CALL_DIRECTION_HEADER) ?? "").trim().toLowerCase() === "outbound";
}

/**
 * null = not an outbound call (inbound rules apply, unchanged).
 * Otherwise the account id to route by — "" means refuse: never fall back
 * to the phone, a default tenant or the demo.
 */
export function outboundCallerUserId(headers: Headers): string | null {
  if (!isOutboundCall(headers)) return null;
  return (headers.get("x-tenant-user-id") ?? "").trim();
}
