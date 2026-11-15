// Plain words on tenant screens (internal-words audit, 15/11): the message
// namespaces every tenant reads (L1) carry no "Persona", "PSTN", "CRM",
// "Sheet" (outside "Google Sheets"), "Live Test"/"LiveTest", "OAuth",
// "token" or "tenant", in fr/en/he. The fast half of the guard; the rendered
// half is scripts/check-tenant-words.mjs. Also probes the matcher itself.
// Run with:  npx tsx scripts/tests/tenant-words.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { stripIcuArguments, visibleText, wordHits } from "../tenant-words-match.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const LOCALES = ["fr", "en", "he"] as const;
type Messages = Record<string, unknown>;
const messages = (l: string): Messages => JSON.parse(readFileSync(join(ROOT, `messages/${l}.json`), "utf8"));
const found = (text: string, locale = "fr") => [...(wordHits(text, locale) as Map<string, string[]>).keys()];

// --- The matcher ---------------------------------------------------------
assert.deepEqual(found("Persona"), ["Persona"]);
assert.deepEqual(found("Instructions du persona"), ["Persona"]);
assert.deepEqual(found("Personnalité · personnaliser"), [], "Personnalité is the decided word");
assert.deepEqual(found("Téléphone (PSTN)"), ["PSTN"]);
assert.deepEqual(found("Contacts CRM"), ["CRM"]);
assert.deepEqual(found("Exporter vers le Sheet"), ["Sheet"]);
assert.deepEqual(found("Charger le sheet"), ["Sheet"], "fr: any case");
assert.deepEqual(found("Importez depuis Google Sheets"), [], "the product name is allowed");
assert.deepEqual(found("Aucun Google Sheet connecté"), ["Sheet"], "only the product name, plural, is allowed");
assert.deepEqual(found("The company sheet", "en"), [], "en: a lowercase sheet is a fact sheet");
assert.deepEqual(found("Export to Sheet", "en"), ["Sheet"]);
assert.deepEqual(found("ייצוא ל-Sheet", "he"), ["Sheet"]);
assert.deepEqual(found("Live Test"), ["Live Test"]);
assert.deepEqual(found("Web LiveTest"), ["LiveTest"]);
assert.deepEqual(found("Live test", "en"), [], "the decided English copy");
assert.deepEqual(found("Re-lancer le flow OAuth (si le token a expiré)"), ["OAuth", "token"]);
assert.deepEqual(found("Compte Google différent du tenant connecté"), ["tenant"]);
assert.deepEqual(found("Signed in as tenant@example.test"), [], "an e-mail address is data, not copy");
assert.deepEqual(found("הגדירו את הפרסונה", "he"), ["Persona"]);
assert.deepEqual(found("שימושי אם הטוקן פג", "he"), ["token"]);
assert.equal(stripIcuArguments("{token} est remplacé par {meaning}."), "{} est remplacé par {}.");
assert.equal(stripIcuArguments("{pstn, plural, one {# téléphone} other {# téléphones}}"), "{, plural, one {# téléphone} other {# téléphones}}");
// visibleText: text and shown attributes, never scripts (the RSC payload).
const html = `<html><head><style>.persona{}</style></head><body><h1>Personnalité</h1>
  <button title="Reconnecter &amp; OAuth">x</button><script>self.__next_f.push("Persona")</script></body></html>`;
assert.match(visibleText(html), /Personnalité/);
assert.deepEqual(found(visibleText(html)), ["OAuth"], "title attribute scanned, script and style not");

// --- The L1 namespaces ---------------------------------------------------
// Every namespace a tenant reads on the dashboard and onboarding. Not here:
// public pages (audit D), Admin*/Plans/the other Email mails (Plans is shared word for word
// with the public pricing cards), and DashboardLogs (developer mode, audit
// B: only its two decided keys are checked, below).
const L1 = [
  "Onboarding",
  "Dashboard",
  "DashboardCrm",
  "DashboardConfig",
  "WebsiteScan",
  "DashboardCampaigns",
  "DashboardCalendar",
  "DashboardContacts",
  "DashboardSettings",
  "DashboardBilling",
  "DashboardForwarding",
  "LiveTest",
  "Bricks",
  "VoiceBrick",
  "PersonaBrick",
  "KnowledgeBrick",
  "ToolsBrick",
  "AgentBrain",
  "AgentUrl",
  "MissionBrick",
  "Calls",
];
// Keys a tenant never reads, each with its reason (audit section C, or not
// rendered anywhere).
const NOT_TENANT_COPY: Record<string, string> = {
  "DashboardConfig.inheritAdminHelp": "admin-only control (InheritAdminField), audit C1",
  "DashboardConfig.maxTokensLabel": "admin control (audit C2), not used by any component today",
  "Onboarding.redirectHintStep1Post": "developer setup text, not used by any component",
  "Onboarding.redirectHintFooter": "developer setup text, not used by any component",
};
const DEV_MODE_KEYS = ["DashboardLogs.sourceTenant", "DashboardLogs.latency.originWeb"];
// The welcome mail every new tenant receives (lib/email.ts sendWelcomeEmail).
const MAILS = ["Email.welcome"];

function* strings(node: unknown, path: string): Generator<[string, string]> {
  if (typeof node === "string") yield [path, node];
  else if (Array.isArray(node)) for (const [i, v] of node.entries()) yield* strings(v, `${path}.${i}`);
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) yield* strings(v, `${path}.${k}`);
}
const at = (m: Messages, path: string) => path.split(".").reduce<unknown>((o, k) => (o as Messages | undefined)?.[k], m);

const problems: string[] = [];
for (const l of LOCALES) {
  const m = messages(l);
  for (const ns of L1) assert.ok(m[ns], `${l}: namespace ${ns} exists`);
  for (const p of MAILS) assert.ok(at(m, p), `${l}: ${p} exists`);
  const entries = [
    ...L1.flatMap((ns) => [...strings(m[ns], ns)]),
    ...MAILS.flatMap((p) => [...strings(at(m, p), p)]),
    ...DEV_MODE_KEYS.map((k) => [k, at(m, k)] as [string, string])];
  for (const [key, value] of entries) {
    assert.equal(typeof value, "string", `${l} ${key} is a message`);
    if (NOT_TENANT_COPY[key]) continue;
    const h = found(stripIcuArguments(value), l);
    if (h.length) problems.push(`${l} ${key}: ${h.join(", ")} in "${value}"`);
  }
}
assert.deepEqual(problems, [], `internal words in tenant copy:\n${problems.join("\n")}`);

// The decided wording itself (FR), so a revert shows up by name.
const fr = messages("fr");
assert.equal(at(fr, "DashboardConfig.personaTitle"), "Personnalité");
assert.equal(at(fr, "Email.welcome.recoCrmTitle"), "{n} · Votre tableau Google des contacts");
assert.equal(at(fr, "Email.welcome.recoPersonaTitle"), "{n} · Ajustez sa personnalité");
assert.equal(at(fr, "DashboardCampaigns.channelsPhone"), "Téléphone");
assert.equal(at(fr, "DashboardContacts.header"), "Contacts");
assert.equal(at(fr, "WebsiteScan.agentsTitle"), "Lecture de votre site");
assert.equal(at(fr, "DashboardLogs.sourceTenant"), "Compte");
assert.equal(at(fr, "DashboardLogs.latency.originWeb"), "Test web");

console.log("tenant-words: ok");
