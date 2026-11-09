// Call-forwarding wizard helpers (lib/forwarding/*).
// Run with:  npx tsx scripts/tests/forwarding-wizard.test.ts

import assert from "node:assert/strict";

import {
  activationCode,
  cancelCode,
  conditionalCodes,
  CARRIERS,
  targetDigits,
  type CarrierForwarding,
} from "../../lib/forwarding/carriers";
import {
  displayStatus,
  formatCountdown,
  secondsLeft,
  shouldPoll,
  telHref,
  toIsraeliLocal,
  type ForwardingTest,
} from "../../lib/forwarding/test-view";

const now = new Date("2026-11-05T10:00:00Z");
const base: ForwardingTest = {
  status: "waiting", startedAt: "2026-11-05T09:55:00Z", expiresAt: "2026-11-05T10:05:00Z",
  detectedAt: null, verifiedAt: null, verifiedMethod: null, tenantNumber: "+972500000000", businessPhone: null,
};
assert.equal(secondsLeft(base, now), 300);
assert.equal(displayStatus(base, now), "waiting");
assert.equal(shouldPoll(base, now), true);
// Window over client-side → shown expired, polling stops.
const late = new Date("2026-11-05T10:05:01Z");
assert.equal(displayStatus(base, late), "expired");
assert.equal(shouldPoll(base, late), false);
assert.equal(shouldPoll({ ...base, status: "detected" }, now), false);
assert.equal(shouldPoll(null, now), false);
assert.equal(secondsLeft({ expiresAt: null }, now), 0);

assert.equal(formatCountdown(300), "5:00");
assert.equal(formatCountdown(61), "1:01");
assert.equal(toIsraeliLocal("+972500000000"), "050-000-0000");
assert.equal(toIsraeliLocal("+97225000000"), "02-500-0000");
assert.equal(toIsraeliLocal("+15550000000"), "+15550000000");
assert.equal(telHref("*21*0500000000#"), "tel:*21*0500000000%23");

assert.equal(targetDigits("+972500000000", "local"), "0500000000");
assert.equal(targetDigits("+972500000000", "e164"), "+972500000000");

// Sourcing rule: no code without an official source.
const unsourced: CarrierForwarding = { id: "partner", line: "mobile", activate: "*21*{number}#", cancel: "#21#", numberFormat: "local", source: null };
assert.equal(activationCode(unsourced, "+972500000000"), null);
assert.equal(cancelCode(unsourced), null);
const sourced = { ...unsourced, source: "https://example.invalid/official" };
assert.equal(activationCode(sourced, "+972500000000"), "*21*0500000000#");
assert.equal(cancelCode(sourced), "#21#");
// Every shipped code carries an https official source.
for (const c of Object.values(CARRIERS)) {
  if (c.activate || c.cancel) assert.ok(c.source?.startsWith("https://"), `${c.id} code without source`);
}
assert.equal(activationCode(CARRIERS.other, "+972500000000"), null);

console.log("ALL FORWARDING-WIZARD TESTS PASSED");

// Shipped codes (quoted from the official pages in lib/forwarding/carriers.ts).
assert.equal(activationCode(CARRIERS.pelephone, "+972500000000"), "*21*0500000000#");
assert.equal(cancelCode(CARRIERS.pelephone), "#21#");
assert.equal(activationCode(CARRIERS.bezeq, "+972500000000"), "*720500000000");
assert.equal(cancelCode(CARRIERS.bezeq), "#72");
assert.equal(activationCode(CARRIERS.partner, "+972500000000"), "*21*0500000000#");
assert.equal(cancelCode(CARRIERS.partner), "#21#");
assert.equal(activationCode(CARRIERS.cellcom, "+972500000000"), "**21*0500000000#");
assert.equal(cancelCode(CARRIERS.cellcom), "##21#");
for (const id of ["hot_mobile", "other"] as const) {
  assert.equal(activationCode(CARRIERS[id], "+972500000000"), null, `${id} must say "contact your carrier"`);
}
// Conditional forwarding ("missed calls only"), sourced carriers only.
{
  assert.deepEqual(conditionalCodes(CARRIERS.partner, "+972500000000"), [
    { kind: "busy", activate: "*67*0500000000#", cancel: "#67#" },
    { kind: "noAnswer", activate: "*61*0500000000**25#", cancel: "#61#" },
    { kind: "unreachable", activate: "*62*0500000000#", cancel: "#62#" },
  ]);
  assert.deepEqual(conditionalCodes(CARRIERS.cellcom, "+972500000000"), [
    { kind: "busy", activate: "**67*0500000000#", cancel: "##67#" },
    { kind: "noAnswer", activate: "**61*0500000000#", cancel: "##61#" },
    { kind: "unreachable", activate: "**62*0500000000#", cancel: "##62#" },
  ]);
  for (const id of ["pelephone", "bezeq", "hot_mobile", "other"] as const) {
    assert.equal(conditionalCodes(CARRIERS[id], "+972500000000"), null, `${id}: no sourced conditional codes`);
  }
  // never without a source
  assert.equal(conditionalCodes({ ...CARRIERS.partner, source: null }, "+972500000000"), null);
}
console.log("ALL FORWARDING-CARRIER TESTS PASSED");
