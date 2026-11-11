// Tenant-facing API names carry no supplier word (tamaraHenry's supplier
// guard covers the copy; this covers the server side).
// Run with:  npx tsx scripts/tests/no-supplier-api.test.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// The live-test token has a neutral path, same handler as the old alias.
assert.ok(existsSync("app/api/live-test/token/route.ts"));
assert.match(readFileSync("app/api/live-test/token/route.ts", "utf8"), /export \{ POST \} from "@\/app\/api\/livekit\/web-token\/route"/);

// call-metrics serves the neutral latency names (legacy ones only for one release).
const metrics = readFileSync("app/api/dashboard/call-metrics/route.ts", "utf8");
assert.match(metrics, /phoneToWorker: setup\.sipWait/);
assert.match(metrics, /workerToCallServer: setup\.connect/);

console.log("ALL NO-SUPPLIER-API TESTS PASSED");
