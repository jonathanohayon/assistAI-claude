// The Live Test panel shows OUR sentence for an error code, never the token
// route's text or the room SDK's message.
// Run with:  npx tsx scripts/tests/live-test-errors.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  LiveTestError,
  liveTestErrorFromResponse,
  liveTestErrorMessage,
  retryAfterMinutes,
  toLiveTestError,
  type LiveTestErrorCode,
} from "../../components/live-test/live-test-error";
import { SUPPLIERS } from "../tenant-bundle-match.mjs";

const root = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(root, p), "utf8");

function test(name: string, fn: () => void) {
  fn();
  console.log(`  ok - ${name}`);
}

const code = (status: number, body: string, retryAfter: string | null = null) =>
  liveTestErrorFromResponse(status, body, retryAfter).code;

// ── Each status / body maps to its code ──────────────────────────────────
const cases: Array<[number, string, LiveTestErrorCode, string]> = [
  // main today
  [500, JSON.stringify({ error: "LiveKit not configured" }), "not_configured", "today's JSON body in words"],
  [500, "LiveKit not configured", "not_configured", "today's plain-text body"],
  // PR #305's exact bodies
  [500, JSON.stringify({ error: "not_configured" }), "not_configured", "#305 not_configured"],
  [429, JSON.stringify({ error: "rate_limited", scope: "account" }), "rate_limited", "#305 rate_limited account"],
  [429, JSON.stringify({ error: "rate_limited", scope: "global" }), "rate_limited", "#305 rate_limited global"],
  [503, JSON.stringify({ error: "unavailable" }), "unavailable", "#305 unavailable"],
  [401, JSON.stringify({ error: "Unauthorized" }), "unauthorized", "401 Unauthorized"],
  [403, JSON.stringify({ error: "Forbidden" }), "forbidden", "403 Forbidden (asUserId by a non-admin)"],
  [
    403,
    JSON.stringify({ error: "plan_feature_required", feature: "outbound_campaigns" }),
    "plan_required",
    "403 plan_feature_required",
  ],
  // anything else
  [500, JSON.stringify({ error: "boom" }), "failed", "500 other"],
  [500, "", "failed", "500 empty body"],
  [502, "<html>Bad gateway</html>", "failed", "502 html"],
  [404, "", "failed", "404"],
  [400, "not json", "failed", "400 plain text"],
];
for (const [status, body, expected, name] of cases) {
  test(`${status} ${name} -> ${expected}`, () => assert.equal(code(status, body), expected));
}

test("error strings match case-sensitively (PLAN_FEATURE_REQUIRED is not the plan code)", () => {
  assert.equal(code(403, JSON.stringify({ error: "PLAN_FEATURE_REQUIRED" })), "forbidden");
  assert.equal(code(500, JSON.stringify({ error: "Unavailable" })), "failed");
  assert.equal(code(500, JSON.stringify({ error: "NOT_CONFIGURED" })), "failed");
});

// ── Retry-After ──────────────────────────────────────────────────────────
test("Retry-After seconds -> minutes, rounded up, minimum 1", () => {
  assert.equal(retryAfterMinutes("0"), 1);
  assert.equal(retryAfterMinutes("1"), 1);
  assert.equal(retryAfterMinutes("60"), 1);
  assert.equal(retryAfterMinutes("61"), 2);
  assert.equal(retryAfterMinutes("3600"), 60);
  assert.equal(retryAfterMinutes(" 120 "), 2);
});
test("Retry-After missing, empty, date form or junk -> null", () => {
  assert.equal(retryAfterMinutes(null), null);
  assert.equal(retryAfterMinutes(undefined), null);
  assert.equal(retryAfterMinutes(""), null);
  assert.equal(retryAfterMinutes("Wed, 21 Oct 2015 07:28:00 GMT"), null);
  assert.equal(retryAfterMinutes("-5"), null);
  assert.equal(retryAfterMinutes("1.5"), null);
});
test("429 carries the minutes; without the header, minutes is null", () => {
  const body = JSON.stringify({ error: "rate_limited", scope: "account" });
  assert.equal(liveTestErrorFromResponse(429, body, "125").minutes, 3);
  assert.equal(liveTestErrorFromResponse(429, body, null).minutes, null);
});

// ── Code -> message key ──────────────────────────────────────────────────
test("rate_limited picks the variant with or without the number", () => {
  assert.deepEqual(liveTestErrorMessage(new LiveTestError("rate_limited", 4)), {
    key: "errors.rateLimited",
    values: { minutes: 4 },
  });
  assert.deepEqual(liveTestErrorMessage(new LiveTestError("rate_limited")), { key: "errors.rateLimitedNoTime" });
});
test("anything not a LiveTestError becomes failed", () => {
  assert.equal(toLiveTestError(new Error("Token endpoint 500: LiveKit not configured")).code, "failed");
  assert.equal(toLiveTestError("x").code, "failed");
  const e = new LiveTestError("connect_failed");
  assert.equal(toLiveTestError(e), e);
});

// ── Messages: same keys in fr/en/he, every code has a line, no supplier ──
const locales = ["fr", "en", "he"] as const;
const errorsOf = (l: string) =>
  (JSON.parse(read(`messages/${l}.json`)) as { LiveTest: { errors: Record<string, string> } }).LiveTest.errors;
const allCodes: LiveTestErrorCode[] = [
  "not_configured",
  "rate_limited",
  "unavailable",
  "unauthorized",
  "forbidden",
  "plan_required",
  "connect_failed",
  "failed",
];

test("LiveTest.errors has the same keys in fr/en/he", () => {
  const fr = Object.keys(errorsOf("fr")).sort();
  for (const l of locales) assert.deepEqual(Object.keys(errorsOf(l)).sort(), fr, l);
});
test("every code (and both rate_limited variants) has a line in each locale", () => {
  for (const l of locales) {
    const errors = errorsOf(l);
    const keys = [
      ...allCodes.map((c) => liveTestErrorMessage(new LiveTestError(c, 2)).key),
      liveTestErrorMessage(new LiveTestError("rate_limited")).key,
    ];
    for (const k of keys) {
      const leaf = k.replace(/^errors\./, "");
      assert.ok(errors[leaf]?.trim(), `${l}: ${k}`);
    }
    assert.ok(errors.rateLimited.includes("{minutes}"), `${l}: rateLimited has {minutes}`);
  }
});
test("no supplier name in any LiveTest message", () => {
  for (const l of locales) {
    const blob = JSON.stringify(
      (JSON.parse(read(`messages/${l}.json`)) as { LiveTest: unknown }).LiveTest,
    ).toLowerCase();
    for (const s of SUPPLIERS) assert.ok(!blob.includes(s), `${l}: LiveTest names "${s}"`);
  }
});

// ── The panel never renders a raw message ────────────────────────────────
test("the panel source never renders e.message / error.message", () => {
  const src = read("components/LiveTestPanelLK.tsx");
  assert.doesNotMatch(src, /\b(e|err|error)\.message\b/);
  assert.doesNotMatch(src, /\{error\}/);
  assert.match(src, /setError\(toLiveTestError\(e\)\)/);
  assert.match(src, /role="alert"/);
});
test("the call setup never builds an error from the server's text", () => {
  const src = read("components/live-test/connect-test-room.ts");
  assert.doesNotMatch(src, /new Error\(/);
  assert.doesNotMatch(src, /Token endpoint/);
  assert.match(src, /liveTestErrorFromResponse\(res\.status/);
  assert.match(src, /new LiveTestError\("connect_failed"\)/);
});

// The config form (which hosts the panel) is a client component: a VALUE
// import from lib/plan-features bundles its tool-name descriptions.
test("config-form imports lib/plan-features for types only", () => {
  const src = read("app/[locale]/dashboard/config-form.tsx");
  for (const m of src.matchAll(/^import\s+(.+?)\s+from\s+"@\/lib\/plan-features";/gm)) {
    assert.match(m[1], /^type\s/, `value import: ${m[0]}`);
  }
});

console.log("ALL LIVE-TEST-ERRORS TESTS PASSED");
