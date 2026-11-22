// Plain words on tenant screens (internal-words audit, 15/11): the message
// namespaces every tenant reads (L1) carry no "Persona", "PSTN", "CRM",
// "Sheet" (outside "Google Sheets"), "Live Test"/"LiveTest", "OAuth",
// "token" or "tenant", in fr/en/he. Every customer e-mail (all of Email.*)
// also carries no "owner", and its fr/he versions no English left over. The
// fast half of the guard; the rendered half is scripts/check-tenant-words.mjs.
// Also probes the matcher itself.
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
// public pages (audit D), Admin*/Plans (Plans is shared word for word
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
// Every customer e-mail (lib/email.ts send*Email, one Email.* namespace each).
// The admin alert mail is plain text in code and goes to us, not customers.
const EMAIL_NAMESPACES = [
  "verification",
  "subscriptionConfirmation",
  "notificationTest",
  "contactCode",
  "ownerRecap",
  "trialWarning",
  "trialDeleted",
  "welcome",
  "usageWarning",
];
const MAILS = EMAIL_NAMESPACES.map((ns) => `Email.${ns}`);

// E-mail-only words, on top of wordHits: the customer is the owner, so a mail
// never calls them "owner" (fr/en/he). And no English left inside the fr/he
// mails: in Hebrew, no Latin word but the brand and product names; in
// French, the English leftovers met in the 15/11 sweep, "dashboard" included
// (the French mails say "tableau de bord", tamaraVP 15/11).
// Hebrew mails speak to the reader in the plural (שלכם, הזינו…), tamaraVP
// 15/11: the singular forms (feminine and masculine) the sweep replaced must
// not come back. Whole words only, so nouns that merely contain them pass.
const HE_LATIN_ALLOWED = new Set(["Tamara", "WhatsApp", "Google", "Calendar", "Sheets"]);
const FR_ENGLISH = [/\brecaps?\b/gi, /\bsettings\b/gi, /\bnotification test\b/gi, /\bagent config\b/gi, /\btransactional\b/gi, /\bdashboards?\b/gi];
const HE_SINGULAR = [
  "שלך", "לך", "הגעת", "תקבל", "קיבלת", "יצרת", "התעלמי", "תוכלי", "שניסית", "צריך עזרה", "תגיבי",
  "בדקי", "התקשרי", "דברי", "את לקוחה", "פתחי", "לחצי", "הזיני", "עברי", "שנני", "התאימי",
];
const HE_SINGULAR_RE = new RegExp(`(?<![\\u05D0-\\u05EA])(${HE_SINGULAR.join("|")})(?![\\u05D0-\\u05EA])`, "g");
function emailHits(text: string, locale: string): string[] {
  const out: string[] = [];
  const plain = stripIcuArguments(text).replace(/<[^>]*>/g, " ");
  if (/\bowners?\b/i.test(plain)) out.push("owner");
  if (locale === "he") {
    if (/בעלים|בעלת העסק|בעל העסק/.test(plain)) out.push("owner");
    for (const [w] of plain.matchAll(/[A-Za-z][A-Za-z-]*/g)) if (!HE_LATIN_ALLOWED.has(w)) out.push(`English "${w}"`);
    for (const [w] of plain.matchAll(HE_SINGULAR_RE)) out.push(`singular "${w}"`);
    // One word for the dashboard in Hebrew mails: "לוח הבקרה" (tamaraVP 15/11),
    // also inside a prefixed form ("מהדאשבורד"). And no French " :" spacing.
    if (/דאשבורד/.test(plain)) out.push('"דאשבורד" (say לוח הבקרה)');
    if (/\s:/.test(plain)) out.push('space before ":"');
  }
  if (locale === "fr") for (const re of FR_ENGLISH) for (const [w] of plain.matchAll(re)) out.push(`English "${w}"`);
  return out;
}
assert.deepEqual(emailHits("{n} · Recap WhatsApp owner", "fr"), ["owner", 'English "Recap"']);
assert.deepEqual(emailHits("{n} · Votre récap WhatsApp", "fr"), [], "the French récap is fine");
assert.deepEqual(emailHits("Set your owner WhatsApp number", "en"), ["owner"]);
assert.deepEqual(emailHits("{n} · סיכום WhatsApp לבעלים", "he"), ["owner"]);
assert.deepEqual(emailHits("ב-<strong>Tamara</strong> · Google Calendar", "he"), [], "brand names and tags are fine");
assert.deepEqual(emailHits("בדיקת Notification", "he"), ['English "Notification"']);
assert.deepEqual(emailHits("Ouvrez votre dashboard", "fr"), ['English "dashboard"']);
assert.deepEqual(emailHits("Ouvrez votre tableau de bord", "fr"), []);
assert.deepEqual(emailHits("הזיני את מספר ה-WhatsApp שלך", "he"), ['singular "הזיני"', 'singular "שלך"']);
assert.deepEqual(emailHits("הזינו את מספר ה-WhatsApp שלכם", "he"), [], "the plural is the decided form");
assert.deepEqual(emailHits("התשלום שלכם · הלקוחות · ברכות", "he"), [], "words containing a form are not hits");
assert.deepEqual(emailHits("הפעילו תוכנית מהדאשבורד:", "he"), ['"דאשבורד" (say לוח הבקרה)']);
assert.deepEqual(emailHits("הפעילו תוכנית מלוח הבקרה:", "he"), []);
assert.deepEqual(emailHits("מה לעשות עכשיו :", "he"), ['space before ":"']);

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
  assert.deepEqual(Object.keys(m.Email as Messages).sort(), [...EMAIL_NAMESPACES].sort(), `${l}: every Email.* namespace is checked`);
  for (const p of MAILS) assert.ok(at(m, p), `${l}: ${p} exists`);
  const entries = [
    ...L1.flatMap((ns) => [...strings(m[ns], ns)]),
    ...MAILS.flatMap((p) => [...strings(at(m, p), p)]),
    ...DEV_MODE_KEYS.map((k) => [k, at(m, k)] as [string, string])];
  for (const [key, value] of entries) {
    assert.equal(typeof value, "string", `${l} ${key} is a message`);
    if (NOT_TENANT_COPY[key]) continue;
    const bare = stripIcuArguments(value);
    const h = [...found(bare, l), ...(key.startsWith("Email.") ? emailHits(bare, l) : [])];
    if (h.length) problems.push(`${l} ${key}: ${h.join(", ")} in "${value}"`);
  }
}
assert.deepEqual(problems, [], `internal words in tenant copy:\n${problems.join("\n")}`);

// The decided wording itself (FR), so a revert shows up by name.
const fr = messages("fr");
assert.equal(at(fr, "DashboardConfig.personaTitle"), "Personnalité");
assert.equal(at(fr, "Email.welcome.recoCrmTitle"), "{n} · Votre tableau Google des contacts");
assert.equal(at(fr, "Email.welcome.recoPersonaTitle"), "{n} · Ajustez sa personnalité");
assert.equal(at(fr, "Email.welcome.recoWhatsappTitle"), "{n} · Votre récap WhatsApp");
assert.equal(at(messages("en"), "Email.welcome.recoWhatsappTitle"), "{n} · Your WhatsApp recap");
assert.equal(at(fr, "DashboardCampaigns.channelsPhone"), "Téléphone");
assert.equal(at(fr, "DashboardContacts.header"), "Contacts");
assert.equal(at(fr, "WebsiteScan.agentsTitle"), "Lecture de votre site");
assert.equal(at(fr, "DashboardLogs.sourceTenant"), "Compte");
assert.equal(at(fr, "DashboardLogs.latency.originWeb"), "Test web");

console.log("tenant-words: ok");
