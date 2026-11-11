// "Ask your agent" (T5) — the screen's TEST: one mock question to the
// customer's agent in the ONE contract shape, the same request the worker
// sends (worker src/client-agent.ts): POST JSON
//   { call_id, turn_id, language, question, caller_said, history }
// signed with X-Tamara-Signature = HMAC-SHA256 hex of the raw body when a
// secret is set. 2.5 s budget. SERVER-ONLY (node:crypto, safeFetch).
//
// The answer says ONLY { ok: true, ms } or { ok: false, reason } — never the
// remote body, its headers or the address it resolved to.

import { createHash, createHmac, randomBytes } from "node:crypto";

import { safeFetch, SafeUrlError, type SafeFetchInit, type SafeFetchOptions, type SafeResponse } from "@/lib/net/safe-url";

/** Same budget as the worker's tool call. */
export const CLIENT_AGENT_TEST_BUDGET_MS = 2500;
/** A test answer is one short sentence: anything bigger is refused. */
export const CLIENT_AGENT_TEST_MAX_BYTES = 64 * 1024;
export const CLIENT_AGENT_TEST_QUESTION = "What are your opening hours?";

export type ClientAgentTestReason =
  /** No url stored or posted. */
  | "no_agent_url"
  /** Any refused address (scheme, port, name, IP, DNS): ONE code, no detail. */
  | "blocked_address"
  | "timeout"
  /** Not a 2xx (redirects included: they are never followed). */
  | "http_status"
  /** 2xx but no non-empty `answer` (or `reply`) string in a JSON body. */
  | "bad_shape"
  | "too_large"
  | "network";

export type ClientAgentTestResult = { ok: true; ms: number } | { ok: false; reason: ClientAgentTestReason };

export type TestFetch = (url: string, init: SafeFetchInit, opts: SafeFetchOptions) => Promise<SafeResponse>;

/** A random id that looks like the worker's hashed call ids. */
export function testCallId(): string {
  return createHash("sha256").update(randomBytes(16)).digest("hex").slice(0, 32);
}

export function clientAgentTestBody(language: string, callId = testCallId()): string {
  return JSON.stringify({
    call_id: callId,
    turn_id: 0,
    language,
    question: CLIENT_AGENT_TEST_QUESTION,
    caller_said: "",
    history: [],
  });
}

export function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * `answer` is the contract field; `reply` (the previous contract) is
 * accepted for one release (decision (a)), like the worker.
 */
export function hasAnswer(body: Buffer): boolean {
  try {
    const parsed = JSON.parse(body.toString("utf8")) as { answer?: unknown; reply?: unknown };
    const raw = typeof parsed?.answer === "string" ? parsed.answer : parsed?.reply;
    return typeof raw === "string" && raw.trim().length > 0;
  } catch {
    return false;
  }
}

export async function runClientAgentTest(
  args: { url: string; secret: string | null; language: string },
  deps: { fetch?: TestFetch; now?: () => number } = {},
): Promise<ClientAgentTestResult> {
  if (!args.url) return { ok: false, reason: "no_agent_url" };
  const now = deps.now ?? Date.now;
  const body = clientAgentTestBody(args.language);
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "Tamara-Voice/1.0" };
  if (args.secret) headers["X-Tamara-Signature"] = signBody(body, args.secret);
  const startedAt = now();
  let res: SafeResponse;
  try {
    res = await (deps.fetch ?? safeFetch)(args.url, { method: "POST", headers, body }, {
      timeoutMs: CLIENT_AGENT_TEST_BUDGET_MS,
      maxBytes: CLIENT_AGENT_TEST_MAX_BYTES,
    });
  } catch (e) {
    const code = e instanceof SafeUrlError ? e.code : "network";
    if (code === "timeout" || code === "too_large" || code === "network") return { ok: false, reason: code };
    if (code === "redirect") return { ok: false, reason: "http_status" };
    return { ok: false, reason: "blocked_address" };
  }
  const ms = Math.max(0, Math.round(now() - startedAt));
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: "http_status" };
  if (!hasAnswer(res.body)) return { ok: false, reason: "bad_shape" };
  return { ok: true, ms };
}
