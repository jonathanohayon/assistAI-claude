// Unit tests for lib/channels (brick C1): every adapter reproduces the rule
// a current code path applies — the former inline expressions are copied
// here verbatim and compared.
// Run with:  npx tsx scripts/tests/channels.test.ts
import assert from "node:assert/strict";

import {
  agentNumberFromRow,
  callMeCallerId,
  campaignDispatchCallerId,
  campaignTestCallerId,
  forwardingFrom,
  inboundCallChannel,
  legacyChannelNumber,
  outboundChannels,
  receptionistChannels,
  WEB_CALL,
} from "../../lib/channels/adapters";
import { WHATSAPP_VOICE_AVAILABLE } from "../../lib/channels/contract";

// ── /api/dashboard/channels: the former inline mapping, verbatim ───────
const WHATSAPP_PREFIX = "whatsapp:";
const former = (row: { id: string; phoneNumber: string; label: string; countryCode: string }) => {
  const isWhatsapp = row.phoneNumber.startsWith(WHATSAPP_PREFIX);
  return {
    id: row.id,
    phoneNumber: isWhatsapp ? row.phoneNumber.slice(WHATSAPP_PREFIX.length) : row.phoneNumber,
    channel: isWhatsapp ? "whatsapp" : "pstn",
    label: row.label,
    countryCode: row.countryCode,
  };
};
const rows = [
  { id: "1", phoneNumber: "+97220000000", label: "", countryCode: "IL" },
  { id: "2", phoneNumber: "whatsapp:+97220000001", label: "WA line", countryCode: "IL" },
  { id: "3", phoneNumber: "+33100000000", label: "Paris", countryCode: "" },
  { id: "4", phoneNumber: "whatsapp:", label: "", countryCode: "" }, // degenerate, same as before
];
for (const r of rows) assert.equal(JSON.stringify(legacyChannelNumber(agentNumberFromRow(r))), JSON.stringify(former(r)), r.id);

// ── Receptionist / outbound views ──────────────────────────────────────
const fwd = {
  forwardingBusinessPhone: "+97230000000",
  forwardingTestStartedAt: new Date("2026-11-01T10:00:00Z"),
  forwardingDetectedAt: null,
  forwardingVerifiedAt: new Date("2026-11-02T10:00:00Z"),
  forwardingVerifiedMethod: "diversion",
};
const rec = receptionistChannels(rows, fwd);
assert.equal(rec.numbers.length, 4, "every account number reaches the receptionist (no change in C1)");
assert.deepEqual(rec.forwarding, {
  businessPhone: "+97230000000", startedAt: "2026-11-01T10:00:00.000Z", detectedAt: null, verifiedAt: "2026-11-02T10:00:00.000Z", method: "diversion",
});
assert.deepEqual(forwardingFrom({ ...fwd, forwardingVerifiedAt: null, forwardingTestStartedAt: null }).verifiedAt, null);
assert.equal(rec.outbound, null);
assert.equal(WHATSAPP_VOICE_AVAILABLE, false, "WhatsApp voice stays hidden until Meta opts the account in");
assert.equal(rec.whatsappVoiceAvailable, false);

// Outbound switches: same reading as normalizeChannels + the agent editor
// (phone on unless false, WhatsApp voice only when true).
for (const [input, phone, wa] of [
  [undefined, true, false], [null, true, false], [{}, true, false], [{ phone: true }, true, false],
  [{ phone: false }, false, false], [{ whatsappVoice: true }, true, true], [{ phone: false, whatsappVoice: true }, false, true],
] as const) {
  assert.deepEqual(outboundChannels(input as never).outbound, { phone, whatsappVoice: wa }, JSON.stringify(input));
}
assert.deepEqual(outboundChannels({ phone: true }).numbers, []);

// ── The channel of one call ────────────────────────────────────────────
assert.deepEqual(inboundCallChannel("+97220000000"), { channel: "pstn", direction: "inbound", agentNumber: "+97220000000" });
assert.deepEqual(inboundCallChannel("whatsapp:+97220000001"), { channel: "whatsapp", direction: "inbound", agentNumber: "+97220000001" });
assert.deepEqual(WEB_CALL, { channel: "web", direction: "inbound", agentNumber: null });

// Caller ids — the former inline expressions, verbatim:
//   dispatch.ts:     fromNumber: job.fromNumber || undefined
//   test-call:       campaign.fromNumber?.trim() || "" → else first number ?? "" → "" = 409
//   call-me:         first number by createdAt, none = 400
for (const from of ["", "+97220000000", "  +97220000000 ", null]) {
  const dispatchFormer = (from as string | null) || undefined;
  assert.equal(campaignDispatchCallerId(from), dispatchFormer ?? null);
  for (const nums of [[], ["+97220000009"], ["+97220000009", "+97220000008"]]) {
    let fromNumber = (from as string | null)?.trim() || "";
    if (!fromNumber) fromNumber = nums[0] ?? "";
    assert.equal(campaignTestCallerId(from, nums), fromNumber || null, `${from} ${nums}`);
  }
}
assert.equal(callMeCallerId([]), null);
assert.equal(callMeCallerId(["+97220000009", "+97220000008"]), "+97220000009");

console.log("ALL CHANNELS TESTS PASSED");
