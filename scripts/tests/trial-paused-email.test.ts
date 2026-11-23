// The end-of-trial e-mail (Email.trialDeleted, sent by sendTrialDeletedEmail)
// tells the truth: at the end of the trial the account is PAUSED, never
// deleted (lib/trial.ts, app/api/cron/trial-cleanup). So, in fr/en/he:
//   - no word of the e-mail says deleted / supprimé / נמחק;
//   - it says the account is paused and the data are kept;
//   - Hebrew writes the name "Tamara" (Latin), never "תמרה";
//   - its button leads to the billing page (pay to reactivate), not to a new
//     sign-up.
// Run with: npx tsx scripts/tests/trial-paused-email.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const LOCALES = ["fr", "en", "he"] as const;
const load = (l: string) => JSON.parse(readFileSync(join(ROOT, `messages/${l}.json`), "utf8"));

// Deleted, in every form: delete(d), deletion, supprimé(e)(s), suppression,
// נמחק / נמחקו / נמחקה, מחיקה, ונמחק.
const DELETED = /delet|supprim|suppression|נמחק|מחיקה|מוחק/i;
const PAUSED: Record<(typeof LOCALES)[number], RegExp> = {
  fr: /en pause/,
  en: /paused/,
  he: /מושהית|הושהתה|תושהה/,
};

for (const l of LOCALES) {
  const mail = load(l).Email.trialDeleted as Record<string, string>;
  assert.ok(mail, `${l} Email.trialDeleted exists`);
  for (const [k, v] of Object.entries(mail))
    assert.doesNotMatch(v, DELETED, `${l} Email.trialDeleted.${k} says deleted: "${v}"`);
  assert.match(mail.subject, PAUSED[l], `${l} subject says paused: "${mail.subject}"`);
  assert.match(mail.introText, PAUSED[l], `${l} introText says paused`);
  assert.match(mail.introHtml, PAUSED[l], `${l} introHtml says paused`);
}

// One spelling of the assistant's name in Hebrew: "Tamara" (Latin), never
// "תמרה", in both trial e-mails (tamaraVP standing rule).
const he = load("he").Email as Record<string, Record<string, string>>;
for (const ns of ["trialDeleted", "trialWarning"])
  for (const [k, v] of Object.entries(he[ns]))
    assert.doesNotMatch(v, /תמרה/, `he Email.${ns}.${k} spells the name in Hebrew: "${v}"`);

// The sender: the button and the text link lead to the billing page.
const email = readFileSync(join(ROOT, "lib/email.ts"), "utf8");
const start = email.indexOf("export async function sendTrialDeletedEmail(");
const end = email.indexOf("export async function", start + 10);
assert.ok(start >= 0 && end > start, "sendTrialDeletedEmail found");
const body = email.slice(start, end);
assert.doesNotMatch(body, /\/signup/, "the paused e-mail never sends the customer to a new sign-up");
assert.equal((body.match(/https:\/\/aitamara\.com\/dashboard\/billing/g) ?? []).length, 2, "text link + button lead to billing");

console.log("trial-paused-email: ok");
