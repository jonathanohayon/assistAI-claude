// Voice brick screen rules (components/bricks/voice/*). Mock data only.
// Run with:  npx tsx scripts/tests/voice-brick.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DEFAULT_VOICE, VOICE_GENDER, VOICE_IDS, mergeVoice } from "../../lib/voice/contract";
import { PACES } from "../../lib/voice-profile";
import { voiceForViewer } from "../../lib/voice/store";
import {
  CLIENT_DEFAULT_VOICE,
  VOICE_PACES,
  mergeClientVoice,
  type ClientVoice,
} from "../../components/bricks/voice/voice-client";
import {
  RECOMMENDED_VOICES,
  addKeyTerm,
  addPronunciation,
  genderOf,
  patienceToScreen,
  hydrateVoice,
  pickerVoices,
  radioKeyTarget,
  voicePatch,
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
  const custom: ClientVoice = { ...CLIENT_DEFAULT_VOICE, advanced: { ...CLIENT_DEFAULT_VOICE.advanced, speed: 1.13 } };
  const r = mergeClientVoice(custom, { pace: "fast" });
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

// every voice has a short descriptor (fits a phone card without truncation)
for (const l of ["en", "fr", "he"]) {
  const d = copy(l).desc as Record<string, string>;
  for (const v of VOICE_IDS) {
    assert.ok(d[v], `${l}: VoiceBrick.desc.${v}`);
    assert.ok(d[v].length <= 16, `${l}: desc.${v} "${d[v]}" is over 16 characters`);
  }
}

// switch helpers describe the current state, one string per state
for (const l of ["en", "fr", "he"]) {
  const c = copy(l);
  for (const k of ["bargeInOn", "bargeInOff", "languageLockOn", "languageLockOff", "fewerVoices"]) assert.ok(c[k], `${l}: ${k}`);
  assert.ok(!("bargeInHint" in c) && !("languageLockHint" in c), `${l}: old two-state hints removed`);
}

// radio keyboard pattern: wraps, mirrored in RTL, Home/End, other keys ignored
{
  const ids = ["a", "b", "c"];
  assert.equal(radioKeyTarget("ArrowRight", ids, "a", false), "b");
  assert.equal(radioKeyTarget("ArrowRight", ids, "a", true), "c", "RTL: right goes back");
  assert.equal(radioKeyTarget("ArrowLeft", ids, "a", false), "c", "wraps");
  assert.equal(radioKeyTarget("ArrowDown", ids, "c", false), "a");
  assert.equal(radioKeyTarget("Home", ids, "c", false), "a");
  assert.equal(radioKeyTarget("End", ids, "a", true), "c");
  assert.equal(radioKeyTarget("Enter", ids, "a", false), null);
  assert.equal(radioKeyTarget("ArrowRight", ids, "zzz", false), "b", "unknown current starts at the first");
}

// hydrate a tenant's served voiceConfig; patch = only what changed
{
  const tenantServed = voiceForViewer({ ...DEFAULT_VOICE, voiceId: "coral", advanced: { ...DEFAULT_VOICE.advanced, idleHangupSec: 45 } }, false) as ClientVoice;
  const v = hydrateVoice(tenantServed);
  assert.equal(v.voiceId, "coral");
  assert.equal(v.advanced.idleHangupSec, 45);
  assert.ok(!("engine" in v), "a tenant's screen value has no engine");
  assert.deepEqual(hydrateVoice(null), CLIENT_DEFAULT_VOICE);

  assert.equal(voicePatch(v, v), null, "nothing changed → nothing sent");
  const r = mergeClientVoice(v, { bargeIn: false, advanced: { idleHangupSec: 60 } });
  assert.ok(r.ok);
  const patch = voicePatch(v, r.ok ? r.value : v);
  assert.deepEqual(patch, { bargeIn: false, advanced: { idleHangupSec: 60 } });

  const custom = hydrateVoice({ ...tenantServed, advanced: { ...tenantServed.advanced, speed: 1.13 } });
  const p2 = mergeClientVoice(custom, { pace: "fast" });
  assert.ok(p2.ok);
  assert.deepEqual(voicePatch(custom, p2.ok ? p2.value : custom), { pace: "fast", advanced: { speed: null } });
  const kt = mergeClientVoice(v, { keyTerms: ["Mock"] });
  assert.deepEqual(voicePatch(v, kt.ok ? kt.value : v), { keyTerms: ["Mock"] });
}

// the browser subset = the contract: same tenant defaults, same paces, and
// the same merge result as the server for every tenant write the screen makes
{
  assert.deepEqual(CLIENT_DEFAULT_VOICE, voiceForViewer(DEFAULT_VOICE, false), "CLIENT_DEFAULT_VOICE = tenant view of DEFAULT_VOICE");
  assert.deepEqual([...VOICE_PACES], [...PACES]);
  const full = { ...DEFAULT_VOICE, advanced: { ...DEFAULT_VOICE.advanced, speed: 1.13 } };
  const tenant = voiceForViewer(full, false) as ClientVoice;
  const writes: Array<Record<string, unknown>> = [
    { voiceId: "cedar" },
    { pace: "fast" },
    { pace: "slow", advanced: { speed: 0.9 } },
    { patience: 1 },
    { bargeIn: false, languageLock: true },
    { noiseReduction: 3 },
    { keyTerms: ["Mock", "Salon Mock"] },
    { pronunciations: [{ term: "Mock", sayAs: "mok" }] },
    { advanced: { minInterruptionMs: 800, idleHangupSec: 60, maxDurationMin: 12 } },
  ];
  for (const w of writes) {
    const server = mergeVoice(full, w);
    const client = mergeClientVoice(tenant, w);
    assert.ok(server.ok && client.ok, JSON.stringify(w));
    assert.deepEqual(client.ok && client.value, server.ok && voiceForViewer(server.value, false), `same merge for ${JSON.stringify(w)}`);
  }
  // and the same refusals for out-of-range values
  for (const w of [{ patience: 9 }, { noiseReduction: 0 }, { advanced: { idleHangupSec: 5 } }, { keyTerms: ["x".repeat(41)] }, { pace: "turbo" }]) {
    assert.equal(mergeVoice(full, w).ok, false, `server refuses ${JSON.stringify(w)}`);
    assert.equal(mergeClientVoice(tenant, w).ok, false, `client refuses ${JSON.stringify(w)}`);
  }
}

// tenant modules never import the full contract or supplier modules at runtime
{
  const TENANT_MODULES = [
    "components/bricks/voice/VoiceBrick.tsx",
    "components/bricks/voice/voice-ui.ts",
    "components/bricks/voice/voice-client.ts",
    "components/bricks/voice/legacy-fields.ts",
    "components/bricks/MoreSettings.tsx",
    "components/bricks/DeveloperModeSwitch.tsx",
    "components/bricks/use-developer-mode.ts",
    "app/[locale]/dashboard/config-form.tsx",
    "app/[locale]/dashboard/config/types.ts",
    "app/[locale]/dashboard/campaigns/agents/agent-editor.tsx",
    "app/[locale]/dashboard/campaigns/agents/agents-workspace.tsx",
    "app/[locale]/dashboard-preview/wow/client.tsx",
  ];
  const FORBIDDEN = /^import (?!type )[^;]*from "@\/lib\/(voice\/contract|voice\/store|voice\/engine|voice\/adapters|voice-profile|realtime-provider|realtime|use-realtime-catalog)"/m;
  for (const f of TENANT_MODULES) assert.doesNotMatch(read(f), FORBIDDEN, `${f}: runtime import of a supplier/full-contract module`);
}

console.log("ALL VOICE-BRICK TESTS PASSED");

