// Tenant-facing API names carry no supplier word (tamaraHenry's supplier
// guard covers the copy; this covers the server side).
// Run with:  npx tsx scripts/tests/no-supplier-api.test.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { EMAIL_TEST_ERRORS } from "../../lib/email-test/policy";
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

console.log("ALL NO-SUPPLIER-API TESTS PASSED");
