// Unit tests for lib/persona-reset-rules.ts (the admin "reset persona to
// neutral" rules) and the routes' sources. The DB side is
// scripts/tests/persona-reset-db.test.ts (bash scripts/persona-reset-db.sh).
// Run with:  npx tsx scripts/tests/persona-reset.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DEFAULT_AGENT_NAME, neutralSeed } from "../../lib/neutral-seed";
import { editedSinceReset, neutralPersona, parseSnapshot, parseUndoBody } from "../../lib/persona-reset-rules";
import { FIRST_CUSTOMER_FACTS } from "./first-customer-facts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(root + p, "utf8");

// neutralSeed carries no first-customer fact, in every locale (and the
// fallback for an unknown one).
for (const l of ["fr", "he", "en", "de", null]) {
  const s = neutralSeed(l);
  for (const t of [s.instructions, s.greeting]) assert.doesNotMatch(t, FIRST_CUSTOMER_FACTS, `${l}: ${t.slice(0, 60)}`);
  const p = neutralPersona(l, "fr");
  for (const t of Object.values(p)) assert.doesNotMatch(t, FIRST_CUSTOMER_FACTS, `reset text ${l}`);
}
assert.doesNotMatch(DEFAULT_AGENT_NAME, FIRST_CUSTOMER_FACTS);

// The agent's language wins; the account locale is the fallback.
assert.equal(neutralPersona("he", "fr").instructions, neutralSeed("he").instructions);
assert.equal(neutralPersona("", "en").greetingInstructions, neutralSeed("en").greeting);
assert.equal(neutralPersona(null, null).instructions, neutralSeed("fr").instructions);
assert.equal(neutralPersona("en", "fr").agentName, DEFAULT_AGENT_NAME);

// The undo rule: the three compared fields, exact match.
const applied = { instructions: "I", greetingInstructions: "G", agentName: "N", personaConfig: { x: 1 } };
assert.deepEqual(editedSinceReset({ instructions: "I", greetingInstructions: "G", agentName: "N" }, applied), []);
assert.deepEqual(editedSinceReset({ instructions: "I ", greetingInstructions: "G", agentName: "M" }, applied), ["instructions", "agentName"]);
assert.deepEqual(editedSinceReset({ instructions: "I", greetingInstructions: "G", agentName: "N" }, null), ["instructions", "greetingInstructions", "agentName"], "a malformed snapshot counts as edited");
assert.equal(parseSnapshot({ instructions: "I", greetingInstructions: 1, agentName: "N" }), null);
assert.deepEqual(parseSnapshot({ instructions: "I", greetingInstructions: "G", agentName: "N" }), { instructions: "I", greetingInstructions: "G", agentName: "N", personaConfig: null });

// The undo body.
const ID = "00000000-0000-4000-8000-000000000001";
assert.deepEqual(parseUndoBody({ resetId: ID }), { ok: true, resetId: ID, force: false });
assert.deepEqual(parseUndoBody({ resetId: ID, force: true }), { ok: true, resetId: ID, force: true });
assert.deepEqual(parseUndoBody({ resetId: ID, force: "true" }), { ok: false, error: "invalid_force" });
assert.deepEqual(parseUndoBody({ resetId: "x" }), { ok: false, error: "invalid_reset_id" });
assert.deepEqual(parseUndoBody([]), { ok: false, error: "invalid_body" });
assert.deepEqual(parseUndoBody(null), { ok: false, error: "invalid_body" });

// The routes: admin-gated first, and never the onboarding template path.
for (const f of ["app/api/admin/users/[userId]/reset-persona/route.ts", "app/api/admin/users/[userId]/reset-persona/undo/route.ts"]) {
  const src = read(f);
  for (const m of src.matchAll(/export async function (GET|POST)[^{]*\{\s*([^\n]*)\n\s*([^\n]*)/g)) {
    assert.equal(m[2].trim(), "const guard = await requireAdmin();", `${f} ${m[1]}: requireAdmin first`);
    assert.equal(m[3].trim(), "if (!guard.ok) return guard.response;", `${f} ${m[1]}`);
  }
  assert.doesNotMatch(src, FIRST_CUSTOMER_FACTS, f);
}
for (const f of ["lib/persona-reset.ts", "lib/persona-reset-rules.ts", "app/api/admin/users/[userId]/reset-persona/route.ts"]) {
  // Code only: comments may name what is avoided.
  const code = read(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.doesNotMatch(code, /seedForNewAccount|getOnboardingTemplateByPlan|getOnboardingGreetingByPlan/, `${f}: no onboarding template`);
}

// The welcome email's default-persona text (messages/*.json recoPersonaBody)
// names the same agent as a new account's seed and the admin reset.
assert.equal(DEFAULT_AGENT_NAME, "Tamara");
for (const l of ["fr", "en", "he"]) {
  const body = (JSON.parse(read(`messages/${l}.json`)) as Record<string, Record<string, Record<string, string>>>);
  const hits = JSON.stringify(body).match(/"recoPersonaBody":"((?:[^"\\]|\\.)*)"/g) ?? [];
  assert.equal(hits.length, 1, `${l}: one recoPersonaBody`);
  assert.ok(hits[0].includes(`\\"${DEFAULT_AGENT_NAME}\\"`), `${l}: the welcome email names ${DEFAULT_AGENT_NAME}`);
  assert.equal(neutralPersona(l, l).agentName, DEFAULT_AGENT_NAME, `${l}: the reset writes the same name`);
  assert.ok(neutralSeed(l).instructions.includes(DEFAULT_AGENT_NAME) && neutralSeed(l).greeting.includes(DEFAULT_AGENT_NAME), `${l}: the seed text names it`);
  assert.ok(!neutralSeed(l).instructions.includes("Sarah"), `${l}: no leftover name in the seed`);
}

console.log("ALL PERSONA-RESET TESTS PASSED");
