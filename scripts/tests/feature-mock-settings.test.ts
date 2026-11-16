// The home's Features mocks show real dashboard settings, in the dashboard's
// own words, at the product's defaults (components/marketing/feature-mock-settings.ts):
//   - every message key the mocks read is one the Voice / Personality tile
//     reads, and exists in fr/en/he;
//   - the slider ranges are the tile's, the positions the product defaults;
//   - the client component hard-codes no setting label.
// Run with:  npx tsx scripts/tests/feature-mock-settings.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AI_DISCLOSURE_DEFAULT,
  CONFIG_MOCK_SWITCHES,
  featureMockLabels,
  NOISE_RANGE,
  PATIENCE_RANGE,
  VOICE_MOCK_KEYS,
} from "../../components/marketing/feature-mock-settings";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const VOICE_TILE = read("components/bricks/voice/VoiceBrick.tsx");
const PERSONA_TILE = read("components/bricks/persona/PersonaBrick.tsx");
const TILE: Record<string, string> = { VoiceBrick: VOICE_TILE, PersonaBrick: PERSONA_TILE };

// --- Keys: the tile's own, present in every locale -----------------------
const keys: [string, string][] = [
  ...Object.values(VOICE_MOCK_KEYS).flatMap((k) => Object.values(k).map((key): [string, string] => ["VoiceBrick", key])),
  ...CONFIG_MOCK_SWITCHES.map((s): [string, string] => [s.ns, s.key]),
];
for (const [ns, key] of keys) {
  assert.ok(TILE[ns].includes(`t("${key}")`), `${ns} tile reads t("${key}")`);
  for (const l of ["fr", "en", "he"]) {
    const m = JSON.parse(read(`messages/${l}.json`));
    const v = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], m[ns]);
    assert.equal(typeof v, "string", `${l}: ${ns}.${key} exists`);
  }
}

// --- Ranges: the tile's <Slider min max> ---------------------------------
const range = (labelKey: string) => {
  const m = VOICE_TILE.match(new RegExp(`label=\\{t\\("${labelKey}"\\)\\}[\\s\\S]*?min=\\{(\\d+)\\}[\\s\\S]*?max=\\{(\\d+)\\}`));
  assert.ok(m, `${labelKey} slider found in the tile`);
  return { min: Number(m[1]), max: Number(m[2]) };
};
assert.deepEqual(range(VOICE_MOCK_KEYS.patience.label), { ...PATIENCE_RANGE });
assert.deepEqual(range(VOICE_MOCK_KEYS.noise.label), { ...NOISE_RANGE });

// --- AI disclosure default: the column's ----------------------------------
assert.ok(
  read("lib/db/schema.ts").includes(`aiDisclosureEnabled: boolean("ai_disclosure_enabled").notNull().default(${AI_DISCLOSURE_DEFAULT})`),
  "AI_DISCLOSURE_DEFAULT = users.ai_disclosure_enabled default",
);

// --- Positions at the product defaults -----------------------------------
const id = (k: string) => k;
const { sliders, switches } = featureMockLabels(id, id);
const by = Object.fromEntries(sliders.map((s) => [s.id, s]));
assert.equal(by.pace.at, 50, "pace: Normal, the centre notch");
assert.deepEqual(by.pace.fill, [50, 0], "pace: no fill at Normal (the tile fills from the centre)");
assert.equal(by.pace.value, "pace.normal");
assert.equal(by.patience.at, 50, "patience: default 3 on 1–5");
assert.equal(Math.round(by.noise.at), 78, "noise: default 8 on 1–10");
assert.deepEqual(by.noise.fill, [0, by.noise.at], "noise: filled from the inline start to the thumb");
assert.deepEqual(
  switches.map((s) => [s.label, s.on]),
  [
    ["bargeInLabel", true],
    ["languageLockLabel", false],
    ["disclosureLabel", true],
  ],
);

// --- The client component hard-codes no setting label ---------------------
const bento = read("components/marketing/FeatureBento.tsx");
for (const word of ["Tone", "Speed", "Warmth", "Coral", "sliders."]) {
  assert.ok(!bento.includes(`"${word}`) && !bento.includes(`\`${word}`), `FeatureBento.tsx hard-codes no "${word}"`);
}
assert.ok(!/from "\.\/feature-mock-settings"/.test(bento.replace(/import type [^;]+;/g, "")), "FeatureBento imports only types (no dashboard defaults in the public bundle)");

console.log("feature-mock-settings: ok");
