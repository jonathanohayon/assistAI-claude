// Voice brick V8c: the receptionist picker reads the server's voice choice.
// Mock data only. Run with:  npx tsx scripts/tests/voice-choice-screen.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { choiceVoices, hasDescriptor, selectedChoice, type ServedVoiceChoice } from "../../components/bricks/voice/voice-ui";
import { engineVoices } from "../../lib/voice/catalogue";
import { tenantVoiceChoice } from "../../lib/voice/choice";
import { DEFAULT_VOICE } from "../../lib/voice/contract";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const opt = (id: string, number: number, gender: "f" | "m", recommended: boolean) => ({ id, number, gender, recommended });
const choice: ServedVoiceChoice = {
  current: "voice-205",
  options: [
    opt("voice-201", 1, "f", false),
    opt("voice-202", 2, "m", true),
    opt("voice-203", 3, "f", true),
    opt("voice-204", 4, "m", true),
    opt("voice-205", 5, "f", false),
    opt("voice-206", 6, "f", true),
  ],
};

// 1. Short list = recommended, female | male per row; the selected one always shows
{
  const ids = (o: ReturnType<typeof choiceVoices>) => o.map((x) => x.id);
  assert.deepEqual(ids(choiceVoices(choice, { gender: "all", showAll: false, selected: null })), ["voice-203", "voice-202", "voice-206", "voice-204"]);
  assert.deepEqual(ids(choiceVoices(choice, { gender: "all", showAll: false, selected: "voice-205" })), ["voice-203", "voice-202", "voice-206", "voice-204", "voice-205"]);
  assert.deepEqual(ids(choiceVoices(choice, { gender: "m", showAll: false, selected: "voice-205" })), ["voice-202", "voice-204"], "the selected voice follows the filter");
  assert.equal(choiceVoices(choice, { gender: "all", showAll: true, selected: null }).length, 6);
}

// 2. Selection: the unsaved pick if it is one of ours, else what the calls use now
{
  assert.equal(selectedChoice(choice, "marin"), "voice-205", "the served name → the server's current");
  assert.equal(selectedChoice(choice, "voice-202"), "voice-202");
  assert.equal(selectedChoice({ ...choice, current: null }, "marin"), null);
}

// 3. "Voice N" is the server's number, never a list position (OpenAI names unchanged)
{
  const served = tenantVoiceChoice(DEFAULT_VOICE, "openai");
  const n = (id: string) => served.options.find((o) => o.id === id)!.number;
  // voice-103 is the catalogue's 3rd OpenAI voice but has been "Voix 7" for customers.
  assert.equal(n("voice-101"), 1);
  assert.equal(n("voice-103"), 7);
  const brick = read("components/bricks/voice/VoiceBrick.tsx");
  assert.match(brick, /n: o\.number/, "the label reads the option's number");
  assert.doesNotMatch(brick.slice(brick.indexOf("function ChoicePicker")), /indexOf\(|n: i\b|i \+ 1/, "no index-based numbering");
}

// 4. Descriptors: our copy, keyed by our id, only for the 1xx family; same words as before
{
  assert.ok(hasDescriptor("voice-101") && !hasDescriptor("voice-201") && !hasDescriptor("voice-301"));
  for (const l of ["fr", "en", "he"]) {
    const vb = JSON.parse(read(`messages/${l}.json`)).VoiceBrick;
    for (const v of engineVoices("openai")) if (vb.desc[v.name]) assert.equal(vb.voiceDesc[v.id], vb.desc[v.name], `${l} ${v.id}`);
    assert.ok(Object.keys(vb.voiceDesc).every(hasDescriptor), `${l}: no descriptor outside 1xx`);
  }
}

// 5. Listen only with the server's sample (the real voice); receptionist only; tenant-safe imports
{
  const brick = read("components/bricks/voice/VoiceBrick.tsx");
  assert.match(brick, /choice\s*\n?\s*\? \(choice\.options\.find\(\(o\) => o\.id === chosen\)\?\.sampleUrl \?\? null\)/);
  assert.doesNotMatch(brick + read("components/bricks/voice/voice-ui.ts"), /from "@\/lib\/voice\/(choice|catalogue|choice-load)"/);
  assert.match(read("app/[locale]/dashboard/config-form.tsx"), /choice=\{voiceChoice\}/);
  assert.match(read("app/[locale]/dashboard/config-form.tsx"), /setVoiceChoice\(saved\.voiceChoice\)/, "a save refreshes the choice");
  // The tile summary says the same "Voice N" as the picker (not the OpenAI equivalent's number).
  assert.match(read("app/[locale]/dashboard/config-form.tsx"), /summary: voiceSummary/);
  assert.match(read("app/[locale]/dashboard/config-form.tsx"), /n: chosenVoice\.number/);
  assert.doesNotMatch(read("app/[locale]/dashboard/campaigns/agents/agent-editor.tsx"), /choice=/, "outbound keeps today's list");
  for (const p of ["app/[locale]/dashboard/page.tsx", "app/admin/users/[userId]/page.tsx"]) assert.match(read(p), /voiceChoice: await voiceChoiceFor\(config,/, p);
}

console.log("ALL VOICE-CHOICE-SCREEN TESTS PASSED");
