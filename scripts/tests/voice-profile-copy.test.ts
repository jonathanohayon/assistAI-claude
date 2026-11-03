// Every voice-profile setting has its "i" copy (label, what, tip) and every
// option/unit/engine a label, in FR, EN and HE. Fields come from
// lib/voice-profile, so a field added there without copy fails here.
// Run : npx tsx scripts/tests/voice-profile-copy.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ADMIN_ONLY_NAMESPACES } from "../../i18n/public-namespaces";
import { VOICE_PROFILE_FIELDS } from "../../lib/voice-profile";

let passed = 0;
const failures: string[] = [];
const group = (label: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`[${label}] ${e instanceof Error ? e.message : e}`);
  }
};

const filled = (v: unknown) => typeof v === "string" && v.trim().length > 0;

group("the copy namespace is admin-only (it names engines)", () => {
  assert.ok(ADMIN_ONLY_NAMESPACES.includes("AdminVoiceProfile"));
});

for (const locale of ["fr", "en", "he"]) {
  const all = JSON.parse(readFileSync(resolve(__dirname, `../../messages/${locale}.json`), "utf8"));
  const c = all.AdminVoiceProfile ?? {};

  group(`${locale}: every field has label / what / tip`, () => {
    const missing: string[] = [];
    for (const f of [...VOICE_PROFILE_FIELDS.map((x) => x.key), "noiseReduction"]) {
      for (const part of ["label", "what", "tip"]) if (!filled(c.fields?.[f]?.[part])) missing.push(`${f}.${part}`);
    }
    assert.deepStrictEqual(missing, []);
  });

  group(`${locale}: every option, unit and engine has a label`, () => {
    const missing: string[] = [];
    for (const f of VOICE_PROFILE_FIELDS) {
      for (const o of f.options ?? []) if (!filled(c.options?.[f.key]?.[o])) missing.push(`options.${f.key}.${o}`);
      if (f.unit && !filled(c.unit?.[f.unit])) missing.push(`unit.${f.unit}`);
      for (const e of f.engines) if (!filled(c.engine?.[e])) missing.push(`engine.${e}`);
      if ((f.kind === "text" || (f.kind === "list" && f.list === "terms")) && !filled(c.fields?.[f.key]?.placeholder))
        missing.push(`fields.${f.key}.placeholder`);
    }
    assert.deepStrictEqual([...new Set(missing)], []);
  });

  group(`${locale}: sections and shared strings`, () => {
    for (const k of ["all", "ours", "engine"]) assert.ok(filled(c.section?.[k]), `section.${k}`);
    for (const k of ["title", "resetAll", "about", "metaRange", "metaDefault", "metaEngines", "engineNone", "allEngines"])
      assert.ok(filled(c[k]), k);
  });
}

console.log(`voice-profile-copy: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error("  ✗", f);
  process.exit(1);
}
