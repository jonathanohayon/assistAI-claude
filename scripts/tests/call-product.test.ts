// calls.product at call end (lib/call-product.ts, lib/call-end-body.ts):
// the productForCall table, and the proof that /api/calls/end writes NULL
// (= reception) for every body the worker can send today — including a body
// that already carries a `clientAgent` field, which calls/end does not parse
// yet (the worker does not send it).
// Run with:  npx tsx scripts/tests/call-product.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { callInsertValues, parseCallEndBody } from "../../lib/call-end-body";
import { CALL_PRODUCTS, productForCall } from "../../lib/call-product";

assert.deepEqual([...CALL_PRODUCTS], ["reception", "sales", "connect"]);

// ── The table ─────────────────────────────────────────────────────────────
const table: Array<[Parameters<typeof productForCall>[0], ReturnType<typeof productForCall>]> = [
  [{ channel: "pstn" }, null],
  [{ channel: "whatsapp" }, null],
  [{ channel: "pstn", clientAgent: false }, null],
  [{ channel: "pstn", clientAgent: "true" }, null],
  [{ channel: "pstn", clientAgent: 1 }, null],
  [{ channel: "pstn", clientAgent: null }, null],
  [{ channel: "pstn", clientAgent: true }, "connect"],
  [{ channel: "whatsapp", clientAgent: true }, "connect"],
];
for (const [input, want] of table) assert.equal(productForCall(input), want, JSON.stringify(input));
console.log(`ok: productForCall table (${table.length} rows)`);

// ── calls/end today: NULL for every body ─────────────────────────────────
const bodies: unknown[] = [
  undefined,
  {},
  { fromNumber: "+15550000001", toNumber: "+15550000002", transcript: [], durationSeconds: 42 },
  { userId: "u", channel: "whatsapp", durationSeconds: 5 },
  { toNumber: "+15550000002", clientAgent: true, product: "connect", origin: { kind: "vox" } },
];
for (const b of bodies) {
  const v = callInsertValues(parseCallEndBody(b), "u", null);
  assert.ok("product" in v, "the insert names product");
  assert.equal(v.product, null, `NULL for ${JSON.stringify(b)}`);
}
console.log("ok: calls/end inserts product NULL (= reception) for every body sent today");

// The hook stays pure (client-safe, no lib/db).
const src = readFileSync(new URL("../../lib/call-product.ts", import.meta.url), "utf8");
assert.doesNotMatch(src, /from "@\/lib\/db|from "\.\/db|lib\/db/, "lib/call-product.ts stays pure");
console.log("ALL CALL PRODUCT TESTS PASSED");
