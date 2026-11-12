// clientIp (lib/rate-limit.ts): X-Real-IP first, then the first X-Forwarded-For
// entry, then "unknown". Best-effort only; see the comment on clientIp.
// Run with:  npx tsx scripts/tests/client-ip.test.ts
import assert from "node:assert/strict";

import { clientIp } from "../../lib/rate-limit";

const h = (o: Record<string, string>) => new Headers(o);

assert.equal(clientIp(h({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 10.0.0.1" })), "203.0.113.7", "X-Real-IP wins");
assert.equal(clientIp(h({ "x-real-ip": "  203.0.113.7  " })), "203.0.113.7", "trimmed");
assert.equal(clientIp(h({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" })), "198.51.100.1", "fallback: first X-Forwarded-For entry");
assert.equal(clientIp(h({ "x-real-ip": "", "x-forwarded-for": " 198.51.100.2 " })), "198.51.100.2", "empty X-Real-IP falls back");
assert.equal(clientIp(h({})), "unknown", "no header");
assert.equal(clientIp(h({ "x-forwarded-for": " , " })), "unknown", "blank list");

console.log("ALL CLIENT-IP TESTS PASSED");
