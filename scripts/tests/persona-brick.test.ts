// Persona brick (P2): preview from the single sources, save patch, legacy
// fields never sent, one screen everywhere. Mock data only.
// Run with:  npx tsx scripts/tests/persona-brick.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { effectiveGreeting } from "../../lib/ai-disclosure";
import { buildCampaignGreeting } from "../../lib/campaigns/prompt";
import { personaFromInbound, personaFromOutbound } from "../../lib/persona/adapters";
import * as store from "../../lib/persona/store";
import { DEFAULT_PERSONA, GREETING_VARIABLES, mergePersona, type Persona } from "../../lib/persona/contract";
import {
  LEGACY_INBOUND_PERSONA_FIELDS,
  LEGACY_OUTBOUND_PERSONA_FIELDS,
  heardGreeting,
  insertVariable,
  badBraces,
  personaPatch,
  personaSaveIssue,
  splitSentences,
  textDirection,
  variablesIn,
  withPersonaConfig,
} from "../../components/bricks/persona/persona-ui";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const P = (over: Partial<Persona> = {}): Persona => ({ ...DEFAULT_PERSONA, name: "Sarah", ...over });

// 1. Preview = the side's single source, never re-implemented
{
  const custom = P({ greeting: { mode: "custom", text: "Bonjour, salon Mock !" } });
  assert.equal(
    heardGreeting(custom, "inbound", { businessName: "Salon Mock" }),
    effectiveGreeting(
      { greetingInstructions: "Bonjour, salon Mock !", agentName: "Sarah", primaryLanguage: "fr", aiDisclosureEnabled: true, aiDisclosureText: "" },
      "Salon Mock",
    ),
  );
  // auto + disclosure on → the default disclosure greeting; auto + off → none (agent opens by itself)
  assert.ok(heardGreeting(P(), "inbound", { businessName: "Salon Mock" }));
  assert.equal(heardGreeting(P({ aiDisclosure: { enabled: false, text: "" } }), "inbound"), null);
  // "auto" never speaks the kept text
  const keptText = P({ greeting: { mode: "auto", text: "Texte gardé" }, aiDisclosure: { enabled: false, text: "" } });
  assert.equal(heardGreeting(keptText, "inbound"), null);
  // outbound: variables substituted by buildCampaignGreeting
  const ob = P({ greeting: { mode: "custom", text: "Bonjour {{name}} !" } });
  const contact = { contactName: "Dana", phoneNumber: "050 000 0000" };
  assert.equal(heardGreeting(ob, "outbound", { exampleContact: contact }), buildCampaignGreeting({ persona: { greeting: "Bonjour {{name}} !" } }, contact));
  assert.equal(heardGreeting(P(), "outbound"), null, "outbound auto: the model opens");
}

// 2. Patch = only what changed; greeting/aiDisclosure key by key
{
  const base = P({ greeting: { mode: "custom", text: "Mon texte" } });
  assert.equal(personaPatch(base, base), null);
  const auto = mergePersona(base, { greeting: { mode: "auto" } });
  assert.ok(auto.ok);
  assert.deepEqual(personaPatch(base, auto.ok ? auto.value : base), { greeting: { mode: "auto" } }, "Automatic sends the mode only: the text is kept");
  const two = mergePersona(base, { name: "Dana", aiDisclosure: { enabled: false } });
  assert.deepEqual(personaPatch(base, two.ok ? two.value : base), { name: "Dana", aiDisclosure: { enabled: false } });
}

// 3. Save bodies never carry a legacy persona field (even unchanged)
{
  const inbound = { agentName: "Sarah", primaryLanguage: "fr", greetingInstructions: "", aiDisclosureEnabled: true, aiDisclosureText: "", instructions: "Mock" };
  assert.deepEqual(withPersonaConfig(inbound, LEGACY_INBOUND_PERSONA_FIELDS, null), { instructions: "Mock" });
  assert.deepEqual(withPersonaConfig(inbound, LEGACY_INBOUND_PERSONA_FIELDS, { name: "Dana" }), { instructions: "Mock", personaConfig: { name: "Dana" } });
  const outbound = { agentName: "Sarah", language: "fr", greeting: "", knowledge: "" };
  assert.deepEqual(withPersonaConfig(outbound, LEGACY_OUTBOUND_PERSONA_FIELDS, null), { knowledge: "" });
}

// 3b. My legacy lists = P3's server lists (the API refuses a mix)
{
  assert.deepEqual([...LEGACY_INBOUND_PERSONA_FIELDS], [...store.LEGACY_INBOUND_PERSONA_FIELDS]);
  assert.deepEqual([...LEGACY_OUTBOUND_PERSONA_FIELDS], [...store.LEGACY_OUTBOUND_PERSONA_FIELDS]);
}

// 4. Reads stay today's (P1 adapters), and the outbound disclosure stays off
{
  const p = personaFromInbound({ agentName: "Sarah", primaryLanguage: "he", greetingInstructions: "שלום", aiDisclosureEnabled: true, aiDisclosureText: "" });
  assert.equal(p.greeting.mode, "custom");
  assert.equal(personaFromOutbound({ agentName: "Mock", language: "en", greeting: "" }).aiDisclosure.enabled, false);
}

// Every variable the screen offers must be substituted by the engine's
// greeting builder, or it would be spoken literally on real calls.
assert.deepEqual([...GREETING_VARIABLES.inbound], [], "the receptionist offers no variable");
for (const v of GREETING_VARIABLES.outbound) {
  const spoken = buildCampaignGreeting({ persona: { greeting: `Bonjour ${v}` } }, { contactName: "Dana", phoneNumber: "050 000 0000" });
  assert.ok(!spoken.includes(v), `${v} is offered but not substituted (spoken: "${spoken}")`);
}

assert.equal(insertVariable("", "{{name}}"), "{{name}}");
assert.equal(insertVariable("Bonjour", "{{name}}"), "Bonjour {{name}}");
assert.equal(insertVariable("Bonjour ", "{{name}}"), "Bonjour {{name}}");

// 5. One screen: every persona screen renders the one PersonaBrick module
const BRICK = /from "@\/components\/bricks\/persona\/PersonaBrick"/;
for (const f of [
  "app/[locale]/dashboard/config/persona-panel.tsx",
  "app/[locale]/dashboard/campaigns/agents/agent-editor.tsx",
  "app/[locale]/dashboard-preview/wow/client.tsx",
]) {
  const src = read(f);
  assert.match(src, BRICK, `${f} imports PersonaBrick`);
  assert.match(src, /<PersonaBrick\b/, `${f} renders <PersonaBrick>`);
}
assert.ok(!existsSync(join(ROOT, "app/[locale]/dashboard/config/ai-disclosure-field.tsx")), "old disclosure field removed");

// 6. No personality slider, no old persona panel copy, no "coming soon" on these screens
function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) yield* walk(rel);
    else if (/\.tsx?$/.test(name)) yield rel;
  }
}
const personaPanels: string[] = [];
for (const top of ["app", "components"]) {
  for (const f of walk(top)) {
    if (f.includes("voice-brick-mock")) continue;
    const src = read(f);
    assert.doesNotMatch(src, /PersonalitySlider|PERSONALITY_SLIDER|wowSlider|PERSONALITY_DEFAULT/, `${f}: personality slider code`);
    if (/function PersonaPanel\b/.test(src)) personaPanels.push(f);
  }
}
assert.deepEqual(personaPanels, ["app/[locale]/dashboard/config/persona-panel.tsx"], "only the receptionist panel wrapper remains (it renders the brick)");
const personaScreens = ["components/bricks/persona/PersonaBrick.tsx", "app/[locale]/dashboard/config/persona-panel.tsx"];
for (const f of personaScreens) assert.doesNotMatch(read(f), /comingSoon|wowComingSoon|bientôt/i, `${f}: coming soon`);

// 7. Gated until their step ships: no languages control (P4), no outbound disclosure (P5)
{
  const brick = read("components/bricks/persona/PersonaBrick.tsx").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
  assert.match(brick, /\{isAdmin && <OtherLanguages /, "other spoken languages: admins only until validated by a test call");
  assert.match(brick, /\{kind === "inbound" && <DisclosureFields /, "disclosure only on inbound before P5");
}

// 7b. Every offered variable has a human label in all three languages
for (const l of ["en", "fr", "he"]) {
  const labels = JSON.parse(read(`messages/${l}.json`)).PersonaBrick.variable as Record<string, string>;
  for (const v of GREETING_VARIABLES.outbound) assert.ok(labels[v.replace(/[{}\s]/g, "")], `${l}: label for ${v}`);
}

// 8. Copy: same keys FR/EN/HE, no supplier name, no "coming soon"
{
  const keys = (o: unknown, p = ""): string[] =>
    Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  const copy = (l: string) => JSON.parse(read(`messages/${l}.json`)).PersonaBrick;
  const en = keys(copy("en")).sort();
  for (const l of ["fr", "he"]) assert.deepEqual(keys(copy(l)).sort(), en, `${l}: same PersonaBrick keys`);
  for (const l of ["en", "fr", "he"]) {
    const text = JSON.stringify(copy(l));
    assert.doesNotMatch(text, /openai|grok|gemini|xai|realtime/i);
    assert.doesNotMatch(text, /coming soon|bientôt|בקרוב/i);
  }
}

// 9. Preview isolation: the heard sentence splits into its sentences, punctuation kept
assert.deepEqual(splitSentences("Bonjour, salon Mock ! אני Sarah, בינה מלאכותית."), ["Bonjour, salon Mock !", "אני Sarah, בינה מלאכותית."]);
assert.deepEqual(splitSentences("Hello"), ["Hello"]);
assert.deepEqual(splitSentences("Un. Deux ? Trois…"), ["Un.", "Deux ?", "Trois…"]);
// mixed scripts: the customer's sentence and the disclosure come out separately (4 combinations)
for (const page of ["fr", "he"] as const) {
  for (const sentence of ["Bonjour, salon Mock !", "שלום, סלון מוק!"]) {
    const heard = heardGreeting(P({ primaryLanguage: page, greeting: { mode: "custom", text: sentence } }), "inbound", { businessName: "Mock" });
    const parts = splitSentences(heard ?? "");
    assert.equal(parts[0], sentence, `${page} page + "${sentence}": the customer's sentence is its own part`);
    assert.ok(parts.length >= 2, "the disclosure is a separate part");
  }
}

// preview paragraph direction = the heard sentence's first strong character
assert.equal(textDirection("שלום, סלון מוק! אני Sarah."), "rtl");
assert.equal(textDirection("Bonjour ! אני Sarah."), "ltr");
assert.equal(textDirection("“ 12, שלום"), "rtl", "neutrals and digits are skipped");
assert.equal(textDirection("…"), "ltr");

// 10. Braces: only the side's exact variables; anything else would be read aloud
{
  const ob = GREETING_VARIABLES.outbound;
  assert.deepEqual(badBraces("Bonjour {{name}}, ici {{phone}}.", ob), []);
  assert.deepEqual(badBraces("Bonjour {{nam", ob), ["{{nam"], "broken token after a deletion");
  assert.deepEqual(badBraces("Bonjour {{city}}", ob), ["{{city}}"], "unknown variable");
  assert.deepEqual(badBraces("Bonjour { Dana", ob), ["{"], "lone brace");
  assert.deepEqual(badBraces("Bonjour {{name}}", GREETING_VARIABLES.inbound), ["{{name}}"], "the receptionist substitutes nothing");
  assert.deepEqual(variablesIn("Bonjour {{name}}", ob), ["{{name}}"]);
  assert.deepEqual(personaSaveIssue(P({ greeting: { mode: "custom", text: "Bonjour {{nam" } }), ob), { kind: "badBraces", tokens: ["{{nam"] });
  assert.equal(personaSaveIssue(P({ greeting: { mode: "auto", text: "Bonjour {{nam" } }), ob), null, "Automatic speaks no text");
  assert.equal(personaSaveIssue(P({ greeting: { mode: "custom", text: "Bonjour {{name}}" } }), ob), null);
  // every variable has an explanation in all three languages; no "Tamara" in this brick's copy
  for (const l of ["en", "fr", "he"]) {
    const c = JSON.parse(read(`messages/${l}.json`)).PersonaBrick;
    for (const v of ob) assert.ok(c.variableMeaning[v.replace(/[{}\s]/g, "")], `${l}: meaning for ${v}`);
    for (const k of ["variableExplained", "badBraces", "saveBlocked"]) assert.ok(c[k], `${l}: ${k}`);
    assert.doesNotMatch(JSON.stringify(c), /Tamara|תמרה/, `${l}: say "your agent", not Tamara`);
  }
}

console.log("ALL PERSONA-BRICK TESTS PASSED");
