// Voice profile (lib/voice-profile.ts): defaults = today, validation, admin-only.
// Run with:  npx tsx scripts/tests/voice-profile.test.ts

import assert from "node:assert/strict";

import { withoutAdminOnlyFields } from "../../lib/realtime-provider";
import {
  DEFAULT_VOICE_PROFILE,
  VOICE_PROFILE_FIELDS,
  effectiveVoiceProfile,
  mergeVoiceProfile,
  voiceProfileSchema,
} from "../../lib/voice-profile";

// defaults = today's exact worker behaviour (2026-11-03)
assert.equal(voiceProfileSchema.safeParse(DEFAULT_VOICE_PROFILE).success, true);
assert.equal(DEFAULT_VOICE_PROFILE.idleHangupSec, 30); // SILENCE_HANGUP_MS
assert.equal(DEFAULT_VOICE_PROFILE.maxDurationMin, 30); // MAX_CALL_DURATION_MS
assert.equal(DEFAULT_VOICE_PROFILE.minInterruptionMs, 500); // LiveKit default
assert.equal(DEFAULT_VOICE_PROFILE.openaiTurnMode, "server_vad");
assert.equal(DEFAULT_VOICE_PROFILE.openaiNoiseReduction, "off");
assert.equal(DEFAULT_VOICE_PROFILE.grokReasoning, "high"); // xAI default
// a tenant with nothing stored gets exactly the defaults
assert.deepEqual(effectiveVoiceProfile(null), DEFAULT_VOICE_PROFILE);
assert.deepEqual(effectiveVoiceProfile({}), DEFAULT_VOICE_PROFILE);
// a corrupt stored value never breaks a call: defaults
assert.deepEqual(effectiveVoiceProfile({ turnSensitivity: "loud" }), DEFAULT_VOICE_PROFILE);

// admin writes: partial merge, validation, reset
let m = mergeVoiceProfile(null, { turnSensitivity: 4 });
assert.ok(m.ok && m.value?.turnSensitivity === 4);
m = mergeVoiceProfile({ turnSensitivity: 4 }, { pace: "fast" });
assert.ok(m.ok);
if (m.ok) assert.deepEqual(m.value, { turnSensitivity: 4, pace: "fast" });
assert.equal(mergeVoiceProfile(null, { turnSensitivity: 9 }).ok, false);
assert.equal(mergeVoiceProfile(null, { grokReasoning: "medium" }).ok, false);
assert.equal(mergeVoiceProfile(null, { unknownField: 1 }).ok, false);
assert.equal(mergeVoiceProfile(null, { keyTerms: Array(51).fill("x") }).ok, false);
assert.equal(mergeVoiceProfile(null, { pronunciations: [{ term: "Tamara", sayAs: "ta-MA-ra" }] }).ok, true);
assert.equal(mergeVoiceProfile(null, { pronunciations: [{ term: "x" }] }).ok, false);
assert.deepEqual(mergeVoiceProfile({ pace: "fast" }, null), { ok: true, value: null });
// the merged result over the defaults
assert.equal(effectiveVoiceProfile({ pace: "fast" }).pace, "fast");
assert.equal(effectiveVoiceProfile({ pace: "fast" }).turnSensitivity, 3);

// tenants never see it (nor the retired temperature)
const visible = withoutAdminOnlyFields({ voice: "marin", voiceProfile: { pace: "fast" }, temperature: 0.8, realtimeProvider: "xai" });
assert.deepEqual(visible, { voice: "marin" });

// every schema field is described for the admin card, with a valid default
const keys = Object.keys(DEFAULT_VOICE_PROFILE).sort();
assert.deepEqual(VOICE_PROFILE_FIELDS.map((f) => f.key).sort(), keys);
for (const f of VOICE_PROFILE_FIELDS) {
  assert.ok(f.doc.length > 20, `${f.key} needs a doc`);
  assert.deepEqual(f.default, DEFAULT_VOICE_PROFILE[f.key], `${f.key} default`);
  if (f.options) assert.ok(f.options.includes(f.default as string), `${f.key} default in options`);
  if (f.min !== undefined) assert.ok((f.default as number) >= f.min && (f.default as number) <= (f.max as number));
  if (f.section === "engine") assert.equal(f.engines.length, 1, `${f.key} is engine-specific`);
}

console.log("ALL VOICE-PROFILE TESTS PASSED");
