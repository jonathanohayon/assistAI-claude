// Voice brick polish (Jonathan's three asks + the Live Test honesty check).
// Mock data only.  Run with:  npx tsx scripts/tests/voice-polish.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const brick = read("components/bricks/voice/VoiceBrick.tsx");
const admin = read("components/bricks/voice/VoiceAdminFields.tsx");
const inbound = read("app/[locale]/dashboard/config-form.tsx");
const outbound = read("app/[locale]/dashboard/campaigns/agents/agent-editor.tsx");
const workspace = read("app/[locale]/dashboard/campaigns/agents/agents-workspace.tsx");

// 1. No "Try it" anywhere; Listen stays (only with a sample); a quiet link to the Live Test where it isn't beside the brick.
for (const [f, src] of [["VoiceBrick", brick], ["config-form", inbound], ["agent-editor", outbound]] as const)
  assert.doesNotMatch(src, /testAction|tryIt/, `${f}: no Try it`);
for (const l of ["fr", "en", "he"]) {
  const vb = JSON.parse(read(`messages/${l}.json`)).VoiceBrick;
  assert.equal(vb.tryIt, undefined, `${l}: tryIt copy removed`);
  assert.ok(vb.liveTestLink && vb.listen, `${l}: link + listen copy`);
}
assert.match(brick, /\{sample && \(\s*<button/, "Listen only with a sample");
assert.match(inbound, /liveTestLink=\{\{ targetId: "live-test", direction: "up", className: "xl:hidden" \}\}/, "inbound: up, hidden from xl (panel beside)");
assert.match(outbound, /liveTestLink=\{draft\.id \? \{ targetId: "agent-live-test", direction: "down" \} : undefined\}/, "outbound: down, saved agents");

// 2. Live Test honesty: it runs on the SAVED config, so it says so while there are unsaved changes — on both screens.
assert.match(inbound, /<LiveTestPanelLK dirty=\{dirty\}/);
assert.match(outbound, /<LiveTestPanelLK dirty=\{dirty\}/);
assert.doesNotMatch(outbound, /dirty=\{false\}/);
assert.match(workspace, /setSavedKey\(\(n\) => n \+ 1\);\s*setDirty\(false\);/, "saved → clean");
for (const l of ["fr", "en", "he"]) assert.ok(JSON.parse(read(`messages/${l}.json`)).LiveTest.saveFirst, `${l}: save-first line`);

// 3. Developer settings order (admin): engine + engine settings, then the call limits, then the samples LAST.
{
  const row = brick.slice(brick.indexOf("<MoreSettings level={3}>"));
  const a = row.indexOf("<VoiceAdminFields"), b = row.indexOf("OUR_ADVANCED_FIELDS.map"), c = row.indexOf("<VoiceSamplesAdmin");
  assert.ok(a > 0 && a < b && b < c, `order engine(${a}) < limits(${b}) < samples(${c})`);
  const fields = admin.slice(admin.indexOf("export function VoiceAdminFields"), admin.indexOf("export function VoiceSamplesAdmin"));
  assert.doesNotMatch(fields, /<GenerateSamples \/>/, "samples are no longer at the top of the engine block");
  assert.ok(fields.indexOf('label={tE("label")}') < fields.indexOf("voiceOverrides"), "engine first, then its settings");
  assert.match(admin, /export function VoiceSamplesAdmin[\s\S]*<AdminBadge size="xs" \/>[\s\S]*<GenerateSamples \/>/, "samples keep the ADMIN badge");
  // Both admin parts stay dynamic imports (supplier names never in a tenant bundle).
  assert.equal(brick.match(/dynamic\(\(\) => import\("\.\/VoiceAdminFields"\)/g)?.length, 2);
}

// 4. Gender colours: tints + words, AA contrast, never a pink→cyan gradient.
{
  const tones = brick.slice(brick.indexOf("const GENDER_TONE"), brick.indexOf("} as const;", brick.indexOf("const GENDER_TONE")));
  assert.doesNotMatch(tones, /from-|to-|gradient/, "no gradient between the gender colours");
  assert.match(brick, /const tone = GENDER_TONE\[VOICE_GENDER\[v\] === "m" \? "m" : "f"\];/);
  assert.match(brick, /\{voiceLabel\(v\)\}<\/span>/, "the gender words stay (voiceLabel says féminine/masculine)");
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  for (const [fg, bg, what] of [
    ["#9d174d", "#fdf2f8", "feminine gender line on its tint"],
    ["#155e75", "#ecfeff", "masculine gender line on its tint"],
    ["#18181b", "#fdf2f8", "name on feminine tint"],
    ["#18181b", "#ecfeff", "name on masculine tint"],
    ["#be185d", "#ffffff", "Féminine chip (selected, white)"],
    ["#0e7490", "#ffffff", "Masculine chip (selected, white)"],
    ["#be185d", "#f1f5f9", "Féminine chip (rest)"],
    ["#0e7490", "#f1f5f9", "Masculine chip (rest)"],
  ] as const)
    assert.ok(ratio(fg, bg) >= 4.5, `${what}: ${ratio(fg, bg).toFixed(2)} < 4.5`);
}

console.log("ALL VOICE-POLISH TESTS PASSED");
