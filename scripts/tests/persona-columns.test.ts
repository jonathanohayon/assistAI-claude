// Persona → legacy body fields (lib/persona/columns.ts): read(write(p))
// round-trips every field the screen can change today. Mock data only.
// Run with:  npx tsx scripts/tests/persona-columns.test.ts

import assert from "node:assert/strict";

import { personaFromInbound, personaFromOutbound } from "../../lib/persona/adapters";
import { changedFields, personaToInboundColumns, personaToOutboundColumns } from "../../lib/persona/columns";
import { DEFAULT_PERSONA, type Persona } from "../../lib/persona/contract";

const base: Persona = {
  ...DEFAULT_PERSONA,
  name: "Tamara",
  primaryLanguage: "he",
  greeting: { mode: "custom", text: "שלום, סלון מוק!" },
  aiDisclosure: { enabled: true, text: "אני בינה מלאכותית." },
};

// inbound: custom greeting, disclosure, name, language round-trip
assert.deepEqual(personaFromInbound(personaToInboundColumns(base)), base);
for (const p of [
  { ...base, name: "" },
  { ...base, primaryLanguage: "en" as const },
  { ...base, aiDisclosure: { enabled: false, text: "" } },
]) {
  assert.deepEqual(personaFromInbound(personaToInboundColumns(p)), p);
}
// auto mode: the text can't be kept until P3 (documented limit)
{
  const auto: Persona = { ...base, greeting: { mode: "auto", text: "kept in the screen" } };
  const back = personaFromInbound(personaToInboundColumns(auto));
  assert.deepEqual(back.greeting, { mode: "auto", text: "" });
}

// outbound: name, language, greeting round-trip; disclosure stays off (P5)
{
  const p: Persona = { ...base, aiDisclosure: { enabled: false, text: "" } };
  assert.deepEqual(personaFromOutbound(personaToOutboundColumns(p)), p);
  assert.ok(!("aiDisclosureEnabled" in personaToOutboundColumns(base)), "no disclosure field for outbound");
  assert.deepEqual(personaToOutboundColumns(base), { agentName: "Tamara", language: "he", greeting: "שלום, סלון מוק!" });
}

// languages are never written (no column until P4)
assert.ok(!("languages" in personaToInboundColumns({ ...base, languages: ["en"] })));

// changed fields only
assert.deepEqual(
  changedFields(personaToInboundColumns(base), personaToInboundColumns({ ...base, name: "Dana" })),
  { agentName: "Dana" },
);
assert.deepEqual(changedFields(personaToOutboundColumns(base), personaToOutboundColumns(base)), {});

console.log("ALL PERSONA-COLUMNS TESTS PASSED");
