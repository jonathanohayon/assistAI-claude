// "Is this number a tamaravox number?" (B4: the creation check) — SERVER-ONLY.
//
// The source is tamaravox itself, the same one the worker trusts:
//   GET ${TAMARAVOX_URL}/api/v1/numbers/exists?phone=<E.164>
//   header x-tamaravox-exists-secret: ${TAMARAVOX_EXISTS_SECRET}
//   200 → an ENABLED vox agent owns the number  → "vox"     (create: 409 tamaravox_number)
//   404 → not a vox number                       → "not_vox" (allowed)
//   anything else (401, 5xx, another status, a network error, the 1500 ms
//   timeout)                                     → "unavailable" (create: 503, FAIL-CLOSED)
//   TAMARAVOX_URL or TAMARAVOX_EXISTS_SECRET unset → "not_configured": the
//   check is SKIPPED (creation allowed) + ONE admin alert a day
//   (vox_check_not_configured), fire-and-forget: it never fails the request.
//
// TAMARAVOX_EXISTS_SECRET is its own env name (not the worker's secret): a
// narrow key that only answers "does this number exist", swappable with no
// code change.
//
// ONLY THE STATUS CODE IS READ. The body is cancelled unread, never parsed,
// logged or stored. Logs carry the outcome and the status code only: never
// the URL (its query holds the number), never a header.
//
// Only the connector create route calls this (lib/connectors/write.ts). The
// call path (lib/agent/**, app/api/agent/**, app/api/calls/**) never imports
// it (source guard: scripts/tests/tamaravox-numbers.test.ts).

import { fireSafely } from "@/lib/agent/fire-safely";
import { alertAdmins } from "@/lib/alerts";

export type VoxCheck = "vox" | "not_vox" | "unavailable" | "not_configured";

export const VOX_CHECK_TIMEOUT_MS = 1500;
export const VOX_EXISTS_PATH = "/api/v1/numbers/exists";
export const VOX_EXISTS_HEADER = "x-tamaravox-exists-secret";
export const VOX_NOT_CONFIGURED_ALERT_KEY = "vox_check_not_configured";
const DAY_MS = 24 * 60 * 60 * 1000;

type Alert = (args: { key: string; subject: string; body: string; dedupMs: number; severity?: "critical" | "warning" }) => Promise<unknown>;

export interface VoxCheckDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  env: () => { url: string | undefined; secret: string | undefined };
  alert: Alert;
  /** The outcome and the status code only (null = no response). */
  log: (outcome: VoxCheck, status: number | null) => void;
  timeoutMs: number;
}

/** Mutable so the DB suites inject the alert sink; production uses these. */
export const voxCheckDeps: VoxCheckDeps = {
  // Resolved at call time (not captured at import).
  fetch: (url, init) => globalThis.fetch(url, init),
  env: () => ({ url: process.env.TAMARAVOX_URL?.trim() || undefined, secret: process.env.TAMARAVOX_EXISTS_SECRET?.trim() || undefined }),
  alert: alertAdmins,
  log: (outcome, status) => {
    if (outcome === "unavailable" || outcome === "not_configured") console.warn(JSON.stringify({ event: "vox_check", outcome, status }));
  },
  timeoutMs: VOX_CHECK_TIMEOUT_MS,
};

/** Discards a body unread (never json() / text()); a failing cancel is ignored. */
function discard(res: Response | null) {
  try {
    void res?.body?.cancel().catch(() => undefined);
  } catch {
    // Nothing: the body is never needed.
  }
}

/** Never throws, never rejects. See the top of this file. */
export async function isTamaravoxNumber(e164: string, deps: VoxCheckDeps = voxCheckDeps): Promise<VoxCheck> {
  let env: { url: string | undefined; secret: string | undefined };
  try {
    env = deps.env();
  } catch {
    env = { url: undefined, secret: undefined };
  }
  if (!env.url || !env.secret) {
    void fireSafely(() =>
      deps.alert({
        key: VOX_NOT_CONFIGURED_ALERT_KEY,
        subject: "Tamaravox number check not configured",
        body: "TAMARAVOX_URL or TAMARAVOX_EXISTS_SECRET is unset on the web service: connectors are created WITHOUT checking that their number is not a tamaravox number. Set both to turn the check on.",
        dedupMs: DAY_MS,
        severity: "warning",
      }),
    );
    void fireSafely(() => deps.log("not_configured", null));
    return "not_configured";
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs);
  let res: Response | null = null;
  let outcome: VoxCheck = "unavailable";
  try {
    // Relative to the base (keeps a path prefix in TAMARAVOX_URL).
    const u = new URL(VOX_EXISTS_PATH.slice(1), env.url.endsWith("/") ? env.url : `${env.url}/`);
    u.searchParams.set("phone", e164);
    // Raced against the timer too: a fetch that ignores the abort still ends here.
    res = await Promise.race([
      deps.fetch(u.href, { method: "GET", headers: { [VOX_EXISTS_HEADER]: env.secret }, signal: ctrl.signal, cache: "no-store", redirect: "manual" }),
      new Promise<never>((_, reject) => ctrl.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true })),
    ]);
    outcome = res.status === 200 ? "vox" : res.status === 404 ? "not_vox" : "unavailable";
  } catch {
    outcome = "unavailable";
  } finally {
    clearTimeout(timer);
    discard(res);
  }
  void fireSafely(() => deps.log(outcome, res ? res.status : null));
  return outcome;
}
