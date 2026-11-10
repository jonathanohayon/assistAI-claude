// Storing `persona` with the agent (P3, write-alongside): lib/persona/store.ts.
// Mock data only. Run with:  npx tsx scripts/tests/persona-store.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { personaFromInbound, personaFromOutbound } from "../../lib/persona/adapters";
import { DEFAULT_PERSONA, type Persona } from "../../lib/persona/contract";
import { personaToInbound, personaToOutbound } from "../../lib/persona/engine";
import {
  currentInboundPersona,
  inboundPersonaAfterLegacy,
  inboundPersonaUpdates,
  outboundPersonaAfterLegacy,
  outboundPersonaUpdates,
} from "../../lib/persona/store";
import { agentConfigs, outboundAgents } from "../../lib/db/schema";

const sql = readFileSync(new URL("../../drizzle/0043_persona_config.sql", import.meta.url), "utf8");
assert.match(sql, /ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "persona_config" jsonb;/);
assert.match(sql, /ALTER TABLE "outbound_agents" ADD COLUMN IF NOT EXISTS "persona_config" jsonb;/);
assert.equal(agentConfigs.personaConfig.notNull, false);
assert.equal(outboundAgents.personaConfig.notNull, false);

const inRow = {
  agentName: "Tamara", primaryLanguage: "fr", greetingInstructions: "Bonjour, salon Mock !",
  aiDisclosureEnabled: true, aiDisclosureText: "", personaConfig: null as unknown,
};
const apply = (row: typeof inRow, u: Record<string, unknown>) => ({ ...row, ...u }) as typeof inRow;

// never written → derived (read-back unchanged)
assert.deepEqual(currentInboundPersona(null, inRow), personaFromInbound(inRow));

// ── "Automatic" never destroys the customer's sentence ──────────────────
{
  // 1) switch to auto: the column gets '' (calls as today), the store keeps the text
  const r1 = inboundPersonaUpdates({ personaConfig: { greeting: { mode: "auto" } } }, inRow, true);
  assert.ok(r1 && !("error" in r1));
  assert.equal(r1.updates.greetingInstructions, "");
  assert.deepEqual(r1.persona.greeting, { mode: "auto", text: "Bonjour, salon Mock !" });
  const row1 = apply(inRow, r1.updates);
  // what callers hear = exactly a legacy save with an empty greeting
  assert.deepEqual(
    personaToInbound(personaFromInbound(row1), { businessName: "Salon Mock" }),
    personaToInbound(personaFromInbound({ ...inRow, greetingInstructions: "" }), { businessName: "Salon Mock" }),
  );
  // the GET returns the stored persona with the text
  assert.equal(currentInboundPersona(row1.personaConfig, row1).greeting.text, "Bonjour, salon Mock !");
  // 2) switch back to custom: the sentence comes back, in the store AND the column
  const r2 = inboundPersonaUpdates({ personaConfig: { greeting: { mode: "custom" } } }, row1, true);
  assert.ok(r2 && !("error" in r2));
  assert.equal(r2.updates.greetingInstructions, "Bonjour, salon Mock !");
  assert.deepEqual(r2.persona.greeting, { mode: "custom", text: "Bonjour, salon Mock !" });
}
// a LEGACY save in auto mode (old screen) keeps the stored sentence too
{
  const stored: Persona = { ...personaFromInbound(inRow), greeting: { mode: "auto", text: "Mock line kept" } };
  const after = inboundPersonaAfterLegacy({ ...inRow, greetingInstructions: "", personaConfig: stored }, { agentName: "Dana" });
  assert.equal(after.name, "Dana");
  assert.deepEqual(after.greeting, { mode: "auto", text: "Mock line kept" });
  // a legacy save WITH a sentence → custom with that sentence
  const after2 = inboundPersonaAfterLegacy({ ...inRow, personaConfig: stored }, { greetingInstructions: "Nouveau." });
  assert.deepEqual(after2.greeting, { mode: "custom", text: "Nouveau." });
  // languages (no column) survive legacy saves, minus the new primary language
  const withLangs: Persona = { ...stored, languages: ["he", "en"] };
  assert.deepEqual(inboundPersonaAfterLegacy({ ...inRow, personaConfig: withLangs }, { primaryLanguage: "he" }).languages, ["en"]);
  // first write = derived
  assert.deepEqual(inboundPersonaAfterLegacy(inRow, {}), personaFromInbound(inRow));
}

// ── full image: the legacy columns written from a persona read back to it ─
{
  const r = inboundPersonaUpdates(
    { personaConfig: { name: "תמרה", primaryLanguage: "he", greeting: { mode: "custom", text: "שלום!" }, aiDisclosure: { enabled: false } } },
    inRow,
    false,
  );
  assert.ok(r && !("error" in r));
  assert.deepEqual(personaFromInbound(apply(inRow, r.updates)), { ...r.persona, languages: [] });
  assert.deepEqual(
    personaToInbound(personaFromInbound(apply(inRow, r.updates)), { businessName: "" }),
    personaToInbound(r.persona, { businessName: "" }),
    "callers hear what the stored persona says",
  );
}

// ── validation and conflicts ────────────────────────────────────────────
{
  const bad = inboundPersonaUpdates({ personaConfig: { aiDisclosure: { text: "Je suis Tamara." } } }, inRow, true);
  assert.ok(bad && "error" in bad && bad.error.body.error === "invalid_persona_config");
  assert.match(String(bad.error.body.fields?.[0]), /ai_disclosure_must_mention_ai/);
  const rep = inboundPersonaUpdates({ personaConfig: { languages: ["fr"] } }, inRow, true);
  assert.ok(rep && "error" in rep, "languages can't repeat the primary");
  const c = inboundPersonaUpdates({ personaConfig: { name: "x" }, agentName: "y", greetingInstructions: "" }, inRow, true);
  assert.ok(c && "error" in c);
  assert.deepEqual(c.error.body, { error: "persona_config_conflict", fields: ["agentName", "greetingInstructions"] });
  assert.equal(inboundPersonaUpdates({ agentName: "y" }, inRow, true), null, "legacy-only body → legacy path");
  // personaConfig + voiceConfig together are independent: no persona conflict
  const both = inboundPersonaUpdates({ personaConfig: { name: "x" }, voiceConfig: { patience: 2 } }, inRow, true);
  assert.ok(both && !("error" in both));
}

// ── outbound ────────────────────────────────────────────────────────────
{
  const row = { agentName: "Sarah", language: "fr", greeting: "Bonjour {{name}} !", personaConfig: null as unknown };
  const r = outboundPersonaUpdates({ personaConfig: { greeting: { mode: "auto" }, name: "Dana" } }, row, true);
  assert.ok(r && !("error" in r));
  assert.equal(r.updates.greeting, "");
  assert.equal(r.updates.agentName, "Dana");
  assert.equal(r.updates.name, "Dana", "`name` follows agentName (normalizeAgentFields rule)");
  assert.deepEqual(r.persona.greeting, { mode: "auto", text: "Bonjour {{name}} !" }, "text kept");
  // empty name → "Sarah" in the columns (as normalizeAgentFields), persona keeps ''
  const e = outboundPersonaUpdates({ personaConfig: { name: "  " } }, row, true);
  assert.ok(e && !("error" in e) && e.updates.agentName === "Sarah" && e.updates.name === "Sarah");
  // what the callee hears = a legacy save with an empty greeting
  const c = { contactName: "Mock Contact" };
  assert.deepEqual(
    personaToOutbound(personaFromOutbound({ ...row, ...(r.updates as object) } as never), c),
    personaToOutbound(personaFromOutbound({ ...row, agentName: "Dana", greeting: "" }), c),
  );
  // conflict
  const k = outboundPersonaUpdates({ personaConfig: {}, language: "he" }, row, true);
  assert.ok(k && "error" in k && k.error.body.error === "persona_config_conflict");
  // legacy save keeps the stored auto sentence and the (P5) disclosure
  const stored: Persona = { ...personaFromOutbound(row), greeting: { mode: "auto", text: "kept" }, aiDisclosure: { enabled: true, text: "" } };
  const after = outboundPersonaAfterLegacy({ ...row, greeting: "", personaConfig: stored }, { agentName: "Noa" });
  assert.deepEqual(after.greeting, { mode: "auto", text: "kept" });
  assert.equal(after.aiDisclosure.enabled, true, "outbound disclosure lives only in the store (P5)");
  assert.equal(after.name, "Noa");
}

assert.deepEqual(DEFAULT_PERSONA.languages, []);
console.log("ALL PERSONA-STORE TESTS PASSED");
