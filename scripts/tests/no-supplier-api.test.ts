// Tenant-facing API names carry no supplier word (tamaraHenry's supplier
// guard covers the copy; this covers the server side).
// Run with:  npx tsx scripts/tests/no-supplier-api.test.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { PATTERN } from "../tenant-bundle-match.mjs";

const SUPPLIER = new RegExp((PATTERN as RegExp).source, "i");

// The live-test token has a neutral path, same handler as the old alias.
assert.ok(existsSync("app/api/live-test/token/route.ts"));
assert.match(readFileSync("app/api/live-test/token/route.ts", "utf8"), /export \{ POST \} from "@\/app\/api\/livekit\/web-token\/route"/);

// call-metrics serves the neutral latency names (legacy ones only for one release).
const metrics = readFileSync("app/api/dashboard/call-metrics/route.ts", "utf8");
assert.match(metrics, /phoneToWorker: setup\.sipWait/);
assert.match(metrics, /workerToCallServer: setup\.connect/);

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
