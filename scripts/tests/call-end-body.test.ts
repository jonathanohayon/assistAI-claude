// Unit tests for parseCallEndBody (lib/call-end-body.ts).
// Run with:  npx tsx scripts/tests/call-end-body.test.ts

import assert from "node:assert/strict";

import { parseCallEndBody } from "../../lib/call-end-body";

// a full worker body is trimmed and kept
const full = parseCallEndBody({
  fromNumber: " +15550000001 ",
  toNumber: "+15550000002",
  userId: "",
  channel: "pstn",
  transcript: [{ role: "user", text: "hello" }],
  durationSeconds: 61.6,
});
assert.equal(full.fromNumber, "+15550000001");
assert.equal(full.toNumber, "+15550000002");
assert.equal(full.transcript.length, 1);
// duration is an integer: the Sheets row formats it as m:ss
assert.equal(full.durationSeconds, 62);

// duration: missing, negative, NaN or a string that is not a number -> 0
assert.equal(parseCallEndBody({}).durationSeconds, 0);
assert.equal(parseCallEndBody({ durationSeconds: -5 }).durationSeconds, 0);
assert.equal(parseCallEndBody({ durationSeconds: "abc" }).durationSeconds, 0);
assert.equal(parseCallEndBody({ durationSeconds: "42" }).durationSeconds, 42);

// channel: only an explicit 'whatsapp' switches to the free-form recap
assert.equal(parseCallEndBody({ channel: "whatsapp" }).channel, "whatsapp");
assert.equal(parseCallEndBody({ channel: "WhatsApp" }).channel, "pstn");
assert.equal(parseCallEndBody({}).channel, "pstn");

// junk bodies never throw
for (const junk of [null, undefined, "x", 42, []]) {
  const r = parseCallEndBody(junk);
  assert.equal(r.fromNumber, "");
  assert.deepEqual(r.transcript, []);
}
// non-string ids are ignored, a non-array transcript becomes empty
const odd = parseCallEndBody({ fromNumber: 123, userId: {}, transcript: "hi" });
assert.equal(odd.fromNumber, "");
assert.equal(odd.userId, "");
assert.deepEqual(odd.transcript, []);

console.log("ALL CALL-END-BODY TESTS PASSED");
