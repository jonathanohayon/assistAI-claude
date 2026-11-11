// Production monitoring rules (lib/monitoring-rules.ts).
// Run with:  npx tsx scripts/tests/monitoring-rules.test.ts

import assert from "node:assert/strict";

import {
  EVENT_ALERTS,
  HEARTBEAT_STALE_MS,
  deadKeys,
  formatDigest,
  heartbeatProblem,
  isQuietHours,
  shouldDeliver,
} from "../../lib/monitoring-rules";

// quiet hours 23:00–07:00 Israel (UTC+2 in November)
const il = (h: number, m = 0) => new Date(Date.UTC(2030, 10, 5, h - 2, m));
assert.equal(isQuietHours(il(23, 30)), true);
assert.equal(isQuietHours(il(3)), true);
assert.equal(isQuietHours(il(6, 59)), true);
assert.equal(isQuietHours(il(7)), false);
assert.equal(isQuietHours(il(14)), false);
assert.equal(isQuietHours(il(22, 59)), false);
// critical always goes out, warnings wait at night
assert.equal(shouldDeliver("critical", il(3)), true);
assert.equal(shouldDeliver("warning", il(3)), false);
assert.equal(shouldDeliver("warning", il(10)), true);

// heartbeat freshness
const now = 1_900_000_000_000;
assert.match(heartbeatProblem(null, now) ?? "", /never/);
assert.equal(heartbeatProblem({ at: now - 60_000, agentName: "a", version: "1" }, now), null);
assert.match(
  heartbeatProblem({ at: now - HEARTBEAT_STALE_MS - 1, agentName: "a", version: "1" }, now) ?? "",
  /No worker heartbeat for 12 min[\s\S]*INTERNAL_SECRET/,
);

// dead keys: only "invalid" (a network blip isn't a dead key)
assert.deepEqual(
  deadKeys({ at: now, agentName: "a", version: "1", keys: { openai: "ok", gemini: "invalid", xai: "unreachable" } }),
  ["gemini"],
);
assert.deepEqual(deadKeys(null), []);

// event alerts: the call-breaking ones are critical
assert.equal(EVENT_ALERTS.realtime_fatal_error?.severity, "critical");
assert.equal(EVENT_ALERTS.provider_key_missing?.severity, "critical");
// The worker's config fallback (no tenant config loaded) alerts at once,
// deduped per code for an hour.
assert.equal(EVENT_ALERTS.config_fallback_used?.severity, "critical");
assert.equal(EVENT_ALERTS.config_fallback_used?.dedupMs, 3600_000);
assert.match(EVENT_ALERTS.config_fallback_used?.subject("http_503") ?? "", /http_503/);
assert.equal(EVENT_ALERTS.gemini_silent_gen?.severity, "warning");
assert.equal(EVENT_ALERTS.realtime_zombie_detected?.severity, "warning");
assert.match(EVENT_ALERTS.realtime_fatal_error!.subject("invalid_api_key"), /invalid_api_key/);
assert.equal(EVENT_ALERTS.call_started, undefined); // ordinary events never alert

// digest text
const text = formatDigest({
  calls: 4, callSeconds: 610, bookings: 2, errors: 3,
  topErrors: [{ event: "book_failed", n: 3 }], heartbeatAgeMin: 2,
  synthetic: { config: 200, greeting: 204 },
});
assert.match(text, /Calls: 4 \(10 min\)/);
assert.match(text, /Bookings: 2/);
assert.match(text, /Errors: 3 \(book_failed 3\)/);
assert.match(text, /Synthetic check: OK/);
assert.match(formatDigest({ calls: 0, callSeconds: 0, bookings: 0, errors: 0, topErrors: [], heartbeatAgeMin: null, synthetic: { config: 401, greeting: "error" } }), /Synthetic check: FAILED \(config 401, greeting error\)/);

console.log("ALL MONITORING-RULES TESTS PASSED");
