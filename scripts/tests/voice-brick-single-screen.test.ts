// Proof for V3: every voice screen is the ONE VoiceBrick module, and no other
// voice UI remains. Also: the screens never send legacy voice fields next to
// voiceConfig (400 voice_config_conflict).
// Run with:  npx tsx scripts/tests/voice-brick-single-screen.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { LEGACY_OUTBOUND_VOICE_FIELDS, withVoiceConfig } from "../../components/bricks/voice/legacy-fields";
import * as store from "../../lib/voice/store";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const BRICK_IMPORT = /from "@\/components\/bricks\/voice\/VoiceBrick"/;

// 1. Each voice screen renders the brick, from the same module.
const SCREENS = [
  "app/[locale]/dashboard/config-form.tsx", // receptionist (tenant + admin view)
  "app/[locale]/dashboard/campaigns/agents/agent-editor.tsx", // outbound agents
  "app/[locale]/dashboard-preview/wow/client.tsx", // public mock dashboard
];
for (const f of SCREENS) {
  const src = read(f);
  assert.match(src, BRICK_IMPORT, `${f} imports the VoiceBrick module`);
  assert.match(src, /<VoiceBrick\b/, `${f} renders <VoiceBrick>`);
}

// 2. The old voice UIs are gone.
for (const f of [
  "app/[locale]/dashboard/config/voice-panel.tsx",
  "app/[locale]/dashboard/config/engine-picker.tsx",
  "app/[locale]/dashboard/config/voice-profile-card.tsx",
  "app/[locale]/dashboard/config/personality-constants.tsx",
]) {
  assert.ok(!existsSync(join(ROOT, f)), `${f} was removed`);
}

// 3. No other voice UI anywhere in app/ or components/.
const FORBIDDEN: Array<[RegExp, string]> = [
  [/function VoicePanel\b|<VoicePanel\b/, "a VoicePanel"],
  [/function EnginePicker\b|<EnginePicker\b/, "an EnginePicker"],
  [/function VoiceProfileCard\b|<VoiceProfileCard\b/, "a VoiceProfileCard"],
  [/function PersonalitySlider\b|<PersonalitySlider\b/, "a personality slider"],
  [/wowSlider(Creativite|Reactivite|Vitesse)/, "the removed créativité/réactivité/speed sliders"],
  [/VOICE_PROFILE_FIELDS/, "a second voice-profile renderer"],
];
function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) yield* walk(rel);
    else if (/\.tsx?$/.test(name)) yield rel;
  }
}
const BRICK_DIR = "components/bricks/voice/";
for (const top of ["app", "components"]) {
  for (const f of walk(top)) {
    if (f.startsWith(BRICK_DIR) || f.includes("voice-brick-mock")) continue;
    const src = read(f);
    for (const [re, what] of FORBIDDEN) assert.doesNotMatch(src, re, `${f} contains ${what}`);
  }
}

// 4. Browser-safe legacy lists = the server's (the API refuses a mix).
// The receptionist form state holds NO legacy voice field at all.
{
  const types = read("app/[locale]/dashboard/config/types.ts");
  const formState = types.slice(types.indexOf("export type FormState = {"), types.indexOf("};", types.indexOf("export type FormState = {")));
  for (const k of store.LEGACY_INBOUND_VOICE_FIELDS) {
    assert.doesNotMatch(formState, new RegExp(`^\\s*${k}\\??:`, "m"), `FormState still has legacy field ${k}`);
  }
}
assert.deepEqual([...LEGACY_OUTBOUND_VOICE_FIELDS], [...store.LEGACY_OUTBOUND_VOICE_FIELDS]);

// 5. Save bodies never carry a legacy voice field next to voiceConfig.
{
  const inbound = { voice: "marin", speed: 1, model: "m", voiceProfile: {}, noiseReductionLevel: 8, temperature: 0.8, realtimeProvider: null, voiceConfig: { stale: true }, agentName: "Mock" };
  const body = withVoiceConfig(inbound, store.LEGACY_INBOUND_VOICE_FIELDS, { bargeIn: false });
  assert.deepEqual(body, { agentName: "Mock", voiceConfig: { bargeIn: false } });
  assert.deepEqual(store.conflictingFields(body, store.LEGACY_INBOUND_VOICE_FIELDS), []);
  // nothing changed in the voice → no voiceConfig, still no legacy field
  assert.deepEqual(withVoiceConfig(inbound, store.LEGACY_INBOUND_VOICE_FIELDS, null), { agentName: "Mock" });

  const outbound = { voice: "marin", personality: {}, noiseReductionLevel: 8, agentName: "Mock" };
  const ob = withVoiceConfig(outbound, LEGACY_OUTBOUND_VOICE_FIELDS, { voiceId: "cedar" });
  assert.deepEqual(ob, { agentName: "Mock", voiceConfig: { voiceId: "cedar" } });
  assert.deepEqual(store.conflictingFields(ob, store.LEGACY_OUTBOUND_VOICE_FIELDS), []);
}

// 6. Pages hand the client the voice as SERVED (tenants: supplier fields
//    removed); the browser fills defaults, so a tenant page never carries them.
for (const f of ["app/[locale]/dashboard/page.tsx", "app/admin/users/[userId]/page.tsx"]) {
  assert.match(read(f), /voiceConfig: voiceForViewer\(currentInboundVoice\(/, `${f} serves voiceForViewer(...)`);
}
assert.match(read("app/[locale]/dashboard/page.tsx"), /voiceForViewer\(currentInboundVoice\(config\.voiceConfig, config\), isAdmin\)/);

console.log("ALL VOICE-BRICK SINGLE-SCREEN TESTS PASSED");
