// Regression test for the proxy.ts matcher.
//
// No test framework is installed — plain tsx + node:assert/strict.
// Run with:  npx tsx scripts/tests/proxy-matcher.test.ts
// Exits non-zero on the first failing assertion, printing the failing case.
//
// WHY THIS EXISTS
// ---------------
// Commit dd6bc35 ("HSTS + upgrade-insecure-requests sur toutes les routes")
// widened the matcher to every route but forgot to exclude `api`. The proxy
// then wrapped NextAuth's own handlers (/api/admin/auth/*) and the auth-gated
// /api/livekit/web-token in its NextResponse.next() + injected CSP/HSTS headers,
// which breaks those framework responses → the session stopped resolving and
// the LiveTest "tester en direct" feature returned `Token endpoint 401`.
//
// The rule this test locks in: the proxy MUST run on page routes (for next-intl
// + security headers) and MUST NOT run on /api/* (API routes own their own
// responses — auth cookies, streaming, etc.).
//
// We assert against the REAL `config` exported from proxy.ts (not a copy), using
// Next's official matcher evaluator, so any future edit to the matcher is caught.

import { AsyncLocalStorage } from "node:async_hooks";

// Next's testing util pulls in server internals that require a global
// AsyncLocalStorage. tsx runs outside the Next runtime, so we provide it before
// importing anything from `next/*`. Harmless: it's the standard Node class.
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;

// Routes the proxy MUST intercept (next-intl locale handling + security headers).
const MUST_MATCH = [
  "/",
  "/fr",
  "/fr/pricing",
  "/he/pricing",
  "/en",
  "/dashboard",
  "/admin",
  "/login",
];

// Routes the proxy MUST NOT intercept. /api/* own their responses; wrapping them
// is what caused the 401 regression. _next/static & favicon are infra excludes.
const MUST_NOT_MATCH = [
  "/api/livekit/web-token", // the endpoint that returned 401
  "/api/admin/auth/session", // NextAuth — reads/rotates the session cookie
  "/api/admin/auth/callback/credentials", // NextAuth login callback
  "/api/auth/login", // legacy Google OAuth flow
  "/api/cron/trial-cleanup",
  "/api/agent/config",
  "/_next/static/chunk.js",
  "/favicon.ico",
];

async function main() {
  const { unstable_doesMiddlewareMatch } = await import(
    "next/experimental/testing/server"
  );
  const { config } = await import("../../proxy");

  const failures: string[] = [];
  let passed = 0;

  const check = (url: string, expected: boolean) => {
    const got = unstable_doesMiddlewareMatch({ config, url });
    if (got === expected) {
      passed++;
    } else {
      failures.push(
        `match(${url}) = ${got}, expected ${expected} ` +
          `(${expected ? "proxy must run on this route" : "proxy must NOT run on this route"})`,
      );
    }
  };

  for (const url of MUST_MATCH) check(url, true);
  for (const url of MUST_NOT_MATCH) check(url, false);

  // Explicit guard on the exact regression: the matcher source must exclude api.
  const matcher = Array.isArray(config.matcher)
    ? config.matcher
    : [config.matcher];
  if (!matcher.some((m) => typeof m === "string" && m.includes("?!api"))) {
    failures.push(
      `proxy matcher must exclude /api via negative lookahead — got ${JSON.stringify(matcher)}`,
    );
  }

  if (failures.length > 0) {
    console.error(`${failures.length} FAILED:`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`ALL ${passed} TESTS PASSED`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
