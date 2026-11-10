// Unit tests for lib/neutral-seed.ts — the persona a NEW account starts with.
// Run with:  npx tsx scripts/tests/neutral-seed.test.ts
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

import { DEFAULT_AGENT_NAME, neutralSeed, seedForNewAccount } from "../../lib/neutral-seed";

const LANGS = ["fr", "he", "en"] as const;

// (c) No business fact of any customer, in any language.
const FACTS = /prestige|johana|j[ée]rusalem|ashdod|natanya|netanya|אשדוד|נתניה|ירושלים|\b\d+\s*(min|minutes|h|heures?|דקות)\b|soins?|épilation|lundi|mercredi|monday|wednesday/i;
for (const l of LANGS) {
  const s = neutralSeed(l);
  for (const t of [s.instructions, s.greeting]) {
    assert.doesNotMatch(t, FACTS, `${l}: ${t.slice(0, 80)}`);
    assert.ok(t.includes(DEFAULT_AGENT_NAME), `${l}: names the agent`);
  }
  assert.equal(s.primaryLanguage, l);
  assert.ok(s.instructions.length < 900, `${l}: short`);
}
// It says to take a message when it doesn't know.
assert.match(neutralSeed("fr").instructions, /prendre un message/);
assert.match(neutralSeed("en").instructions, /take a message/);
assert.match(neutralSeed("he").instructions, /הודעה/);
// Unknown locale → French (the column's default).
assert.equal(neutralSeed("de").primaryLanguage, "fr");
assert.equal(neutralSeed(null).instructions, neutralSeed("fr").instructions);

// (b) The admin's per-plan template and greeting still win.
const t = seedForNewAccount("global", "en", { global: "  ADMIN TEMPLATE  " }, { global: "ADMIN GREETING" });
assert.deepEqual(t, { instructions: "ADMIN TEMPLATE", greeting: "ADMIN GREETING", primaryLanguage: "en" });
const other = seedForNewAccount("premium", "he", { global: "ADMIN TEMPLATE" }, {});
assert.equal(other.instructions, neutralSeed("he").instructions, "another plan's template doesn't apply");
assert.equal(seedForNewAccount("global", "fr", { global: "   " }, {}).instructions, neutralSeed("fr").instructions, "blank template → neutral");

// (a) Only account CREATION uses it: one importer, which only inserts.
const importers = execSync(`grep -rl --include="*.ts" --include="*.tsx" --include="*.mjs" "neutral-seed" app lib scripts auth.ts | grep -v scripts/tests/ || true`, { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
assert.deepEqual(importers, ["lib/auth/provision-tenant.ts"]);
const provision = execSync("cat lib/auth/provision-tenant.ts", { encoding: "utf8" });
assert.doesNotMatch(provision, /\.update\(agentConfigs\)/, "provisioning never updates an existing agent config");

console.log("ALL NEUTRAL-SEED TESTS PASSED");
