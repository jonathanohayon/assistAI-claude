// Voice brick screen rules (components/bricks/voice/*). Mock data only.
// Run with:  npx tsx scripts/tests/voice-brick.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DEFAULT_VOICE, VOICE_GENDER, VOICE_IDS, mergeVoice } from "../../lib/voice/contract";
import {
  RECOMMENDED_VOICES,
  addKeyTerm,
  addPronunciation,
  genderOf,
  patienceToScreen,
  pickerVoices,
  screenToPatience,
  showLevel3,
} from "../../components/bricks/voice/voice-ui";
import { engineOptionOf, engineOptionPatch } from "../../components/bricks/voice/voice-admin";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

// recommended: 6 known voices, 3 + 3, interleaved female | male
assert.equal(RECOMMENDED_VOICES.length, 6);
for (const v of RECOMMENDED_VOICES) assert.ok(VOICE_IDS.includes(v), `${v} is a contract voice`);
assert.deepEqual(RECOMMENDED_VOICES.map(genderOf), ["f", "m", "f", "m", "f", "m"]);

// picker: recommended first, rest with "all", gender filter, selected always shown
assert.deepEqual(pickerVoices(VOICE_IDS, { gender: "all", showAll: false, selected: "marin" }), [...RECOMMENDED_VOICES]);
assert.equal(pickerVoices(VOICE_IDS, { gender: "all", showAll: true, selected: "marin" }).length, VOICE_IDS.length);
assert.ok(pickerVoices(VOICE_IDS, { gender: "f", showAll: true, selected: "marin" }).every((v) => VOICE_GENDER[v] === "f"));
assert.ok(pickerVoices(VOICE_IDS, { gender: "all", showAll: false, selected: "onyx" }).includes("onyx"));

// patience shown flipped, round trip
for (let p = 1; p <= 5; p++) assert.equal(screenToPatience(patienceToScreen(p)), p);
assert.equal(patienceToScreen(5), 1, "stored 5 (answers soonest) = screen 1 (answers quickly)");

// key terms and pronunciations
assert.deepEqual(addKeyTerm(["Mock"], " mock "), ["Mock"], "no case-insensitive duplicate");
assert.deepEqual(addKeyTerm([], "  Salon Mock "), ["Salon Mock"]);
assert.deepEqual(addKeyTerm([], "   "), []);
assert.equal(addKeyTerm([], "x".repeat(60))[0].length, 40);
assert.deepEqual(addPronunciation([{ term: "Mock", sayAs: "mok" }], "mock", "moke"), [{ term: "mock", sayAs: "moke" }]);

// level 3: admins always, tenants only in developer mode
assert.equal(showLevel3({ isAdmin: true, developerMode: false }), true);
assert.equal(showLevel3({ isAdmin: false, developerMode: false }), false);
assert.equal(showLevel3({ isAdmin: false, developerMode: true }), true);

// pace: picking a preset clears a kept custom speed (contract rule the custom chip relies on)
{
  const custom = { ...DEFAULT_VOICE, advanced: { ...DEFAULT_VOICE.advanced, speed: 1.13 } };
  const r = mergeVoice(custom, { pace: "fast" });
  assert.ok(r.ok && r.value.advanced.speed === null && r.value.pace === "fast");
}

// admin engine mapping round trips
for (const id of ["openai-2", "openai-2.1", "gemini", "xai"] as const) {
  const r = mergeVoice(DEFAULT_VOICE, engineOptionPatch(id));
  assert.ok(r.ok);
  assert.equal(engineOptionOf(r.ok ? r.value : DEFAULT_VOICE), id);
}
assert.equal(engineOptionOf({ engine: "openai", advanced: { ...DEFAULT_VOICE.advanced, model: "gpt-mock-x" } }), "custom");

// no supplier name reaches tenant code: brick + its copy
const tenantSources = [
  "components/bricks/voice/VoiceBrick.tsx",
  "components/bricks/voice/voice-ui.ts",
  "components/bricks/MoreSettings.tsx",
  "components/bricks/DeveloperModeSwitch.tsx",
];
const SUPPLIER = /\b(openai|gemini|grok|xai|gpt-realtime)\b/i;
for (const f of tenantSources) {
  const code = read(f).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "").replace(/import\(".\/VoiceAdminFields"\)/, "");
  assert.doesNotMatch(code, SUPPLIER, `${f} must not name a supplier`);
}
// admin fields are only reachable through next/dynamic
assert.match(read("components/bricks/voice/VoiceBrick.tsx"), /dynamic\(\(\) => import\("\.\/VoiceAdminFields"\)/);
assert.doesNotMatch(read("components/bricks/voice/VoiceBrick.tsx"), /from "\.\/voice-admin"|from "\.\/VoiceAdminFields"/);

// copy: same keys in FR/EN/HE, no supplier names, no "coming soon"
const keys = (o: unknown, p = ""): string[] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
const copy = (l: string) => JSON.parse(read(`messages/${l}.json`)).VoiceBrick;
const en = keys(copy("en")).sort();
for (const l of ["fr", "he"]) assert.deepEqual(keys(copy(l)).sort(), en, `${l}: same VoiceBrick keys as en`);
for (const l of ["en", "fr", "he"]) {
  const text = JSON.stringify(copy(l));
  assert.doesNotMatch(text, SUPPLIER, `${l}: VoiceBrick copy names no supplier`);
  assert.doesNotMatch(text, /coming soon|bientôt|בקרוב/i, `${l}: no "coming soon"`);
}

console.log("ALL VOICE-BRICK TESTS PASSED");
