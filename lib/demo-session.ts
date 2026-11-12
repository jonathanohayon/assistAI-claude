// SERVER-ONLY. What the public landing demo (components/VoiceAgent.tsx) gets
// back from POST /api/session, and the server-side choices behind it.
//
// The browser must not carry anything provider-specific: no model id, no
// provider catalogue, no instructions, no tool names. The server mints the
// session with all of them already set, then returns only what the browser
// needs to connect (the short-lived token and the URL to POST its SDP offer
// to) and how to run each tool call the model makes (an opaque route table:
// the browser looks up the name the data channel gives it, it never ships
// one). Pure, so scripts/tests/demo-session.test.ts covers it.

import type { Transport } from "@/lib/realtime";

/**
 * Anonymous demo sessions mint provider client secrets on our account. Counted
 * in the shared DB limiter (lib/rate-limit-db.ts), so the cap holds across
 * replicas and restarts: per client IP (hashed, lib/verification-limits
 * limiterKey) and route-wide, the backstop lib/rate-limit.ts clientIp asks for.
 */
export const DEMO_SESSION_BUCKET = "demo_session";
export const DEMO_SESSION_WINDOW_MS = 10 * 60_000;
export const DEMO_SESSION_PER_IP = 5;
export const DEMO_SESSION_GLOBAL = 100;

/** How the browser runs a tool call: POST its arguments to `endpoint`, or hang up. */
export type DemoToolRoute = { endpoint: string } | { hangUp: true };

/**
 * One entry per tool in the demo session (lib/realtime.ts REALTIME_TOOLS).
 * Same endpoints as the browser called before; anonymous callers land in
 * lib/google.ts "demo" mode there (lib/demo-sandbox.ts: free slots read,
 * booking and contact simulated).
 */
export const DEMO_TOOL_ROUTES: Readonly<Record<string, DemoToolRoute>> = {
  check_availability: { endpoint: "/api/calendar/availability" },
  book_appointment: { endpoint: "/api/calendar/book" },
  save_contact: { endpoint: "/api/sheets/contact" },
  end_call: { hangUp: true },
};

/**
 * The demo voice, as the browser used to pick it: the demo account's voice
 * when the model accepts it; with no demo voice, the provider's catalogue
 * default (what the browser's catalogue fallback sent); a demo voice the
 * model rejects falls back to the env-aware default, as the route did.
 */
export function demoSessionVoice(opts: {
  demoVoice: string | null | undefined;
  allowed: readonly string[];
  catalogueDefault: string;
  routeDefault: string;
}): string {
  const { demoVoice, allowed, catalogueDefault, routeDefault } = opts;
  if (!demoVoice) return allowed.includes(catalogueDefault) ? catalogueDefault : routeDefault;
  return allowed.includes(demoVoice) ? demoVoice : routeDefault;
}

export interface DemoSessionResponse {
  value: string;
  expires_at: number | null;
  /** Where the browser POSTs its SDP offer (the model is in the query). */
  webrtc_url: string;
  transport: Transport;
  tools: Readonly<Record<string, DemoToolRoute>>;
}

/**
 * The provider's client_secrets answer, cut down to what the browser needs.
 * The provider also echoes the whole session (instructions, tools, model):
 * that part never leaves the server.
 */
export function demoSessionResponse(
  minted: { value?: unknown; expires_at?: unknown },
  opts: { webrtcUrl: string; model: string; transport: Transport },
): DemoSessionResponse | null {
  if (typeof minted.value !== "string" || !minted.value) return null;
  return {
    value: minted.value,
    expires_at: typeof minted.expires_at === "number" ? minted.expires_at : null,
    webrtc_url: `${opts.webrtcUrl}?model=${encodeURIComponent(opts.model)}`,
    transport: opts.transport,
    tools: DEMO_TOOL_ROUTES,
  };
}
