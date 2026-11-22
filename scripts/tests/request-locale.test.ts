// Un-prefixed /dashboard aliases (lib/request-locale.ts). Mock values.
// Run with:  npx tsx scripts/tests/request-locale.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildQueryString, dashboardTarget, pickLocale } from "../../lib/request-locale";

// locale order: cookie, then Accept-Language, then the default
assert.equal(pickLocale("he", "en-US,en;q=0.9"), "he");
assert.equal(pickLocale("xx", "en-US,en;q=0.9"), "en"); // unknown cookie ignored
assert.equal(pickLocale(undefined, "he-IL,fr;q=0.8"), "he");
assert.equal(pickLocale(undefined, "de-DE, EN;q=0.5"), "en"); // first supported tag, case-insensitive
assert.equal(pickLocale(undefined, "de-DE"), "fr");
assert.equal(pickLocale(undefined, null), "fr");
assert.equal(pickLocale("", ""), "fr");

// query kept, repeated keys included
assert.equal(buildQueryString({}), "");
assert.equal(buildQueryString({ x: "1" }), "?x=1");
assert.equal(buildQueryString({ a: ["1", "2"], b: "x y", c: undefined }), "?a=1&a=2&b=x+y");

// /dashboard itself
assert.equal(dashboardTarget("fr", [], {}), "/fr/dashboard");
assert.equal(dashboardTarget("he", undefined, { tab: "x" }), "/he/dashboard?tab=x");

// deeper paths, segments kept
assert.equal(dashboardTarget("fr", ["reception"], {}), "/fr/dashboard/reception");
assert.equal(dashboardTarget("en", ["logs"], { x: "1" }), "/en/dashboard/logs?x=1");
assert.equal(dashboardTarget("fr", ["a", "b"], {}), "/fr/dashboard/a/b");
assert.equal(dashboardTarget("fr", ["calls", "3f2b-9a_1.v2"], {}), "/fr/dashboard/calls/3f2b-9a_1.v2");

// nothing escapes /<locale>/dashboard: unsafe tails are dropped, query kept
const escapes: string[][] = [
  [".."],
  ["..", "admin"],
  ["%2e%2e", "admin"],
  ["."],
  ["a", "..", "..", "admin"],
  ["a/b"], // decoded %2F
  ["%2F", "evil.com"],
  ["a\\b"],
  ["", "evil.com"],
  ["//evil.com"],
  ["a b"],
  ["a\u0000"],
  [".hidden"],
];
for (const rest of escapes) {
  assert.equal(dashboardTarget("fr", rest, { x: "1" }), "/fr/dashboard?x=1", JSON.stringify(rest));
}
// every target starts with /<locale>/dashboard and is followed by "/", "?" or the end
for (const rest of [...escapes, ["reception"], ["a", "b"]]) {
  assert.match(dashboardTarget("he", rest, {}), /^\/he\/dashboard(?:\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)*$/);
}

// both alias pages go through the helper (no second copy of the logic)
for (const f of ["app/dashboard/page.tsx", "app/dashboard/[...rest]/page.tsx"]) {
  const src = readFileSync(f, "utf8");
  assert.match(src, /from "@\/lib\/request-locale"/, f);
  assert.match(src, /resolveRequestLocale\(\)/, f);
  assert.match(src, /dashboardTarget\(/, f);
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /accept-language|NEXT_LOCALE|URLSearchParams|next\/headers/i, f);
}
// the layout stays a thin re-export
assert.match(
  readFileSync("app/dashboard/layout.tsx", "utf8"),
  /export \{ default, metadata \} from "\.\.\/_root\/plain-root-layout";/,
);

console.log("request-locale: all assertions passed");
