// Pure part of the shared DB-backed rate limiter (lib/rate-limit-db.ts): the
// ledger format and the decision. No I/O, so it is unit-tested directly.
//
// Ledger (one per bucket): { "<accountId>": [epoch ms of each accepted attempt] }.
// Only account ids and timestamps: no address, no number. Only accepted
// attempts are written, so a bucket never holds more than `global` entries.

export type RateLimitScope = "account" | "global";
export type RateLimitResult = { ok: true } | { ok: false; scope: RateLimitScope; retryAfterSec: number };
export type RateLimitLedger = Record<string, number[]>;
export interface RateLimitRule {
  windowMs: number;
  perAccount: number;
  global: number;
}

/** Throws on a bucket or rule a caller got wrong (a bug, not a user error). */
export function assertRateLimitInput(bucket: string, accountId: string, rule: RateLimitRule): void {
  if (!/^[a-z0-9_]{1,64}$/.test(bucket)) throw new Error(`rate-limit-db: invalid bucket "${bucket}"`);
  if (typeof accountId !== "string" || !accountId) throw new Error("rate-limit-db: accountId required");
  for (const k of ["windowMs", "perAccount", "global"] as const) {
    if (!Number.isInteger(rule[k]) || rule[k] <= 0) throw new Error(`rate-limit-db: ${k} must be a positive integer`);
  }
}

/** Parses a stored ledger; anything unexpected reads as empty. */
export function parseRateLimitLedger(raw: string | null | undefined): RateLimitLedger {
  if (!raw) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: RateLimitLedger = {};
  for (const [k, list] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const ts = list.filter((t): t is number => typeof t === "number" && Number.isFinite(t));
    if (ts.length) out[k] = ts;
  }
  return out;
}

const retryAfter = (oldest: number, now: number, windowMs: number) =>
  Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));

/**
 * One attempt by `accountId` at `now`. Returns the result and the ledger to
 * store: entries outside the window dropped; on ok, `now` recorded. The
 * account limit is checked first, then the global one.
 */
export function decideRateLimit(
  ledger: RateLimitLedger,
  accountId: string,
  now: number,
  rule: RateLimitRule,
): { result: RateLimitResult; next: RateLimitLedger } {
  const next: RateLimitLedger = {};
  const all: number[] = [];
  for (const [k, list] of Object.entries(ledger)) {
    const kept = list.filter((t) => now - t < rule.windowMs).sort((a, b) => a - b);
    if (kept.length) {
      next[k] = kept;
      all.push(...kept);
    }
  }
  const mine = next[accountId] ?? [];
  if (mine.length >= rule.perAccount) {
    // Frees up when the oldest attempt that keeps it at the limit leaves the window.
    const t = mine[mine.length - rule.perAccount];
    return { result: { ok: false, scope: "account", retryAfterSec: retryAfter(t, now, rule.windowMs) }, next };
  }
  if (all.length >= rule.global) {
    all.sort((a, b) => a - b);
    const t = all[all.length - rule.global];
    return { result: { ok: false, scope: "global", retryAfterSec: retryAfter(t, now, rule.windowMs) }, next };
  }
  next[accountId] = [...mine, now];
  return { result: { ok: true }, next };
}
