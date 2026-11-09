// Owner's morning WhatsApp digest (lib/owner-digest.ts, lib/call-type.ts).
// Run with:  npx tsx scripts/tests/owner-digest.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { inferCallType } from "../../lib/call-type";
import { agentConfigs } from "../../lib/db/schema";
import { formatOwnerDigest, shouldSendDigest, yesterdayWindow } from "../../lib/owner-digest";

// ON by default, idempotent migration
assert.equal(agentConfigs.ownerDigestEnabled.default, true);
const sql = readFileSync(new URL("../../drizzle/0036_owner_digest.sql", import.meta.url), "utf8");
assert.match(sql, /ADD COLUMN IF NOT EXISTS "owner_digest_enabled" boolean DEFAULT true NOT NULL/);

// "yesterday" is the Jerusalem calendar day, midnight to midnight local
{
  // 2026-11-05 05:00 UTC = 07:00 Jerusalem (UTC+2) → yesterday = 11-04
  const w = yesterdayWindow(new Date("2026-11-05T05:00:00Z"));
  assert.equal(w.day, "2026-11-04");
  assert.equal(w.start.toISOString(), "2026-11-03T22:00:00.000Z");
  assert.equal(w.end.toISOString(), "2026-11-04T22:00:00.000Z");
  // 23:30 UTC on the 4th is already the 5th in Jerusalem → yesterday = 11-04
  assert.equal(yesterdayWindow(new Date("2026-11-04T23:30:00Z")).day, "2026-11-04");
  // summer (UTC+3)
  const s = yesterdayWindow(new Date("2026-07-10T04:00:00Z"));
  assert.equal(s.day, "2026-07-09");
  assert.equal(s.start.toISOString(), "2026-07-08T21:00:00.000Z");
  // DST end day (2026-10-25 in Israel) is 25 h long
  const dst = yesterdayWindow(new Date("2026-10-26T05:00:00Z"));
  assert.equal(dst.day, "2026-10-25");
  assert.equal(dst.end.getTime() - dst.start.getTime(), 25 * 3600 * 1000);
}

// nothing sent for a day with zero calls
const zero = { calls: 0, minutes: 0, bookings: 0, messages: 0, transfers: 0 };
assert.equal(shouldSendDigest(zero), false);
assert.equal(shouldSendDigest({ ...zero, calls: 1 }), true);

// text per language (mock business)
const stats = { calls: 7, minutes: 18, bookings: 3, messages: 2, transfers: 1 };
const fr = formatOwnerDigest("fr", "2026-11-04", stats, {
  businessName: "Salon Mock",
  dashboardUrl: "https://example.test/dashboard",
});
assert.equal(
  fr,
  [
    "☀️ Bilan d'hier (mercredi 4 novembre) — Salon Mock",
    "📞 Appels : 7 (18 min)",
    "📅 RDV pris : 3",
    "✉️ Messages à traiter : 2",
    "↪️ Appels transférés : 1",
    "",
    "https://example.test/dashboard",
  ].join("\n"),
);
assert.match(formatOwnerDigest("he", "2026-11-04", stats), /^☀️ סיכום אתמול .*\n📞 שיחות: 7 \(18 דק׳\)/);
assert.match(formatOwnerDigest("en", "2026-11-04", stats), /^☀️ Yesterday \(Wednesday 4 November\)\n📞 Calls: 7 \(18 min\)/);
assert.ok(fr.length < 1000, "fits the template variable");

// call type helper moved verbatim from /api/calls/end
assert.equal(inferCallType("La cliente laisse un message pour Dana", []), "Message");
assert.equal(inferCallType("", ["je voudrais annuler"]), "Annulation");
assert.equal(inferCallType("RDV pris pour mardi", []), "RDV");
assert.equal(inferCallType("question sur les prix", []), "Info");

console.log("ALL OWNER-DIGEST TESTS PASSED");
