// Tenant-facing API names carry no supplier word (tamaraHenry's supplier
// guard covers the copy; this covers the server side).
// Run with:  npx tsx scripts/tests/no-supplier-api.test.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { EMAIL_TEST_ERRORS } from "../../lib/email-test/policy";
import { VERIFICATION_ERRORS } from "../../lib/verification-limits/policy";
import { LIVE_TEST_ERRORS } from "../../lib/live-test/policy";
import { PATTERN } from "../tenant-bundle-match.mjs";

// The live-test token has a neutral path, same handler as the old alias.
assert.ok(existsSync("app/api/live-test/token/route.ts"));
assert.match(readFileSync("app/api/live-test/token/route.ts", "utf8"), /export \{ POST \} from "@\/app\/api\/livekit\/web-token\/route"/);

// call-metrics serves the neutral latency names (legacy ones only for one release).
const metrics = readFileSync("app/api/dashboard/call-metrics/route.ts", "utf8");
assert.match(metrics, /phoneToWorker: setup\.sipWait/);
assert.match(metrics, /workerToCallServer: setup\.connect/);

// The notification email-test route: its API error strings name no supplier
// (incl. the email supplier, absent from PATTERN on purpose), no env var, and
// pass no raw provider error through. Code only (comments stripped).
const SUPPLIER = new RegExp((PATTERN as RegExp).source, "i");
const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
for (const f of ["app/api/dashboard/notifications/email-test/route.ts", "lib/email-test/handler.ts"]) {
  const src = code(f);
  assert.doesNotMatch(src, SUPPLIER, `${f} names a supplier`);
  assert.doesNotMatch(src, /resend/i, `${f} names the email supplier`);
  assert.doesNotMatch(src, /process\.env|[A-Z][A-Z0-9]*_(API_KEY|FROM|SECRET|TOKEN)\b/, `${f} names an env var`);
  assert.doesNotMatch(src, /hint\s*:|error\s*:\s*result\.error/, `${f} passes provider detail to a response`);
}
// Every error the handler builds is one of the neutral codes, through fail() only.
const handler = code("lib/email-test/handler.ts");
const codes = [...handler.matchAll(/fail\("([a-z_]+)"/g)].map((m) => m[1]);
assert.ok(codes.length >= 7);
for (const c of codes) assert.ok((EMAIL_TEST_ERRORS as readonly string[]).includes(c), `non-neutral code ${c}`);
for (const c of EMAIL_TEST_ERRORS) assert.doesNotMatch(c, SUPPLIER);
assert.equal([...handler.matchAll(/NextResponse\.json\(/g)].length, 2, "only fail() and the 200 build responses");

// The public verification paths (resend route + signup action): no supplier,
// no env var in code; the route answers only through fail() / ACCEPTED with a
// neutral code (provider errors stay in the server log).
for (const f of [
  "app/api/auth/resend-verification/route.ts",
  "lib/verification-limits/resend.ts",
  "lib/verification-limits/signup.ts",
  "lib/verification-limits/policy.ts",
  "app/[locale]/signup/page.tsx",
]) {
  const src = code(f);
  assert.doesNotMatch(src, SUPPLIER, `${f} names a supplier`);
  assert.doesNotMatch(src, /process\.env|[A-Z][A-Z0-9]*_(API_KEY|FROM|SECRET|TOKEN)\b/, `${f} names an env var`);
  // "resend" is also a plain verb here (route path, identifiers), so the email
  // supplier is checked by its SDK and host; response bodies are checked
  // dynamically in verification-limits.test.ts.
  assert.doesNotMatch(src, /from "resend"|resend\.com/i, `${f} names the email supplier`);
}
const resendSrc = code("lib/verification-limits/resend.ts");
assert.equal([...resendSrc.matchAll(/\bbody: \{/g)].length, 2, "responses are built by fail() and ACCEPTED only");
for (const m of resendSrc.matchAll(/fail\("([a-z_]+)"/g)) {
  assert.ok((VERIFICATION_ERRORS as readonly string[]).includes(m[1]), `non-neutral code ${m[1]}`);
}
for (const c of VERIFICATION_ERRORS) assert.doesNotMatch(c, SUPPLIER);

// The live-test token route: the handler that builds every response names no
// supplier and no env var; every error goes through fail() with a listed code.
// (The deprecated route file's own path names the supplier; that is the alias
// kept for one release, not a response.)
{
  const src = code("lib/live-test/handler.ts");
  assert.doesNotMatch(src, SUPPLIER, "live-test handler names a supplier");
  assert.doesNotMatch(src, /process\.env|[A-Z][A-Z0-9]*_(API_KEY|URL|SECRET|TOKEN)\b/, "live-test handler names an env var");
  const route = code("app/api/livekit/web-token/route.ts");
  assert.doesNotMatch(route, /NextResponse|process\.env/, "the route only delegates to the handler");
  assert.match(route, /handleLiveTestToken\(req, liveTestDeps\)/);
  const used = [...src.matchAll(/fail\("([A-Za-z_]+)"/g)].map((m) => m[1]);
  assert.ok(used.length >= 5);
  for (const c of used) assert.ok((LIVE_TEST_ERRORS as readonly string[]).includes(c), `non-neutral code ${c}`);
  for (const c of LIVE_TEST_ERRORS) assert.doesNotMatch(c, SUPPLIER);
  assert.equal([...src.matchAll(/NextResponse\.json\(/g)].length, 2, "only fail() and the 200 build responses");
}

// The WhatsApp test route answers with neutral codes only: every error string
// in the route and its logic is one of the codes, never a supplier or an env
// var name (the old route returned the raw provider error and env hints).
const WA_CODES = new Set([
  "invalid_number", "recipient_not_allowed", "no_saved_number", "rate_limited", "send_failed", "not_configured",
  "Unauthorized", "Forbidden",
]);
for (const f of ["app/api/dashboard/notifications/whatsapp-test/route.ts", "lib/notifications/whatsapp-test.ts"]) {
  const src = readFileSync(f, "utf8");
  const errors = [...src.matchAll(/error: "([^"]*)"|fail\(\d+, "([^"]*)"\)/g)].map((m) => m[1] ?? m[2]);
  assert.ok(errors.length > 0, `${f}: no error strings found`);
  for (const e of errors) {
    assert.ok(WA_CODES.has(e), `${f}: unexpected error string "${e}"`);
    assert.doesNotMatch(e, SUPPLIER, `${f}: "${e}" names a supplier`);
  }
  // Responses are built from the code only: no `hint`, `provider` or raw `result.error` field.
  assert.doesNotMatch(src, /\bhint:|\bprovider:|error: result\.error/, `${f}: leaks provider details`);
}

console.log("ALL NO-SUPPLIER-API TESTS PASSED");
