// The signed connector route token (B3) — SERVER-ONLY.
//
// The route is RECORDED at session-config and READ BACK at /api/calls/end,
// never re-evaluated there (a connector toggled / edited / deleted mid-call
// would otherwise misattribute the call), and never trusted raw:
//   session-config serves `connectorRoute` ONLY on a connector route whose
//   client agent is actually served; the worker echoes it back in the
//   calls/end body; calls/end verifies it here.
//
// Format: base64url(JSON { v: 1, accountId, connectorId, iat }) + "." +
//         base64url(HMAC-SHA256(key, <the first part>)).
//   iat = seconds since the epoch at signing. Valid for 24 h.
// The payload is SIGNED, not encrypted: it carries ids only, never a secret.
//
// Key: HKDF-SHA256 of the current SECRETS_KEY (E1's master key, parsed by
// lib/crypto/secret-box.ts currentKeyForDerivation), info "connector-route-v1",
// empty salt, 32 bytes — the same derivation as lib/crypto/derived-keys.ts,
// with NO override env var (never a new env var). No SECRETS_KEY → no key:
// no token is served and calls are recorded as today. Rotating SECRETS_KEY
// invalidates tokens of calls in flight (those calls are recorded as today,
// with the daily alert).
// The key is never logged, returned or put in an error message.
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

import { currentKeyForDerivation } from "@/lib/crypto/secret-box";
// Installs E1's misconfigured-key reporter, as lib/crypto/derived-keys.ts does.
import "@/lib/crypto/unreadable-secret";

type Env = Record<string, string | undefined>;

export const CONNECTOR_ROUTE_KEY_LABEL = "connector-route-v1";
export const CONNECTOR_ROUTE_TOKEN_VERSION = 1;
export const CONNECTOR_ROUTE_MAX_AGE_S = 24 * 60 * 60;
/** Clock skew tolerated on iat in the future (web and worker clocks). */
const FUTURE_SKEW_S = 5 * 60;
/** A token longer than this is refused before any parsing. */
const MAX_TOKEN_LENGTH = 1024;

/** The token key (HKDF of SECRETS_KEY), or null when SECRETS_KEY is unset / malformed. Never throws. */
export function connectorRouteKey(env: Env = process.env): Buffer | null {
  const master = currentKeyForDerivation(env);
  if (!master) return null;
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), CONNECTOR_ROUTE_KEY_LABEL, 32));
}

const b64u = (b: Buffer) => b.toString("base64url");
const mac = (key: Buffer, body: string) => createHmac("sha256", key).update(body, "utf8").digest();

export function signConnectorRoute(
  claims: { accountId: string; connectorId: string; iat?: number },
  key: Buffer,
): string {
  const body = b64u(
    Buffer.from(
      JSON.stringify({
        v: CONNECTOR_ROUTE_TOKEN_VERSION,
        accountId: claims.accountId,
        connectorId: claims.connectorId,
        iat: claims.iat ?? Math.floor(Date.now() / 1000),
      }),
      "utf8",
    ),
  );
  return `${body}.${b64u(mac(key, body))}`;
}

export type RouteTokenFailure = "no_key" | "malformed" | "signature" | "version" | "account" | "expired";
export type RouteTokenCheck = { ok: true; connectorId: string } | { ok: false; reason: RouteTokenFailure };

/**
 * Verifies a token for THIS call's account. Signature first (timing-safe),
 * then v = 1, the account, iat within 24 h. Pure given the key; never throws.
 */
export function verifyConnectorRoute(
  token: unknown,
  args: { accountId: string; key: Buffer | null; nowMs?: number },
): RouteTokenCheck {
  if (!args.key) return { ok: false, reason: "no_key" };
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, sig] = parts;
  const expected = mac(args.key, body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "signature" };
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!claims || typeof claims !== "object") return { ok: false, reason: "malformed" };
  const c = claims as Record<string, unknown>;
  if (c.v !== CONNECTOR_ROUTE_TOKEN_VERSION) return { ok: false, reason: "version" };
  if (typeof c.accountId !== "string" || typeof c.connectorId !== "string" || !c.connectorId) {
    return { ok: false, reason: "malformed" };
  }
  if (typeof c.iat !== "number" || !Number.isFinite(c.iat)) return { ok: false, reason: "malformed" };
  if (c.accountId !== args.accountId) return { ok: false, reason: "account" };
  const now = Math.floor((args.nowMs ?? Date.now()) / 1000);
  if (now - c.iat > CONNECTOR_ROUTE_MAX_AGE_S || c.iat - now > FUTURE_SKEW_S) return { ok: false, reason: "expired" };
  return { ok: true, connectorId: c.connectorId };
}

/**
 * The payload field session-config adds on a connector route: `{ connectorRoute }`,
 * or `{}` when there is no key (or anything throws). Never throws.
 */
export function connectorRouteField(accountId: string, connectorId: string, env: Env = process.env): { connectorRoute?: string } {
  try {
    const key = connectorRouteKey(env);
    return key ? { connectorRoute: signConnectorRoute({ accountId, connectorId }, key) } : {};
  } catch {
    return {};
  }
}
