// The agent URL card lives in Réglages (since #419), so its copy can no
// longer point "above" at the personality: it names the "My agent" page, with
// the sidebar's own label (DashboardNav.myAgent). The lead sentence says what
// the URL is for: the client's own voice service queries the Tamara agent on
// every speaking turn.
// Run with:  npx tsx scripts/tests/agent-url-copy.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const messages = (l: string) => JSON.parse(readFileSync(join(ROOT, `messages/${l}.json`), "utf8"));
const LOCALES = ["fr", "en", "he"] as const;

const DESC = {
  fr: "Votre propre service vocal interroge l'agent Tamara à chaque tour de parole, grâce à cette URL.",
  en: "Your own voice service queries the Tamara agent on every speaking turn, through this URL.",
  // [HE] to confirm: plural address ("שלכם").
  he: "השירות הקולי שלכם פונה לסוכן של תמרה בכל תור דיבור, באמצעות הכתובת הזו.",
};
const URL_HINT = {
  fr: "Collez-la dans un service vocal pour que votre agent réponde au téléphone. Elle utilise la personnalité réglée dans Mon agent.",
  en: "Paste it into a voice service so your agent answers the phone. It uses the personality set in My agent.",
  // [HE] to confirm: plural address ("הדביקו", "שלכם"), page named in quotes.
  he: 'הדביקו אותה בשירות קולי כדי שהסוכן שלכם יענה לטלפון. היא משתמשת באישיות שהוגדרה בדף "הסוכן שלי".',
};

// 1. Exact strings, three languages.
for (const l of LOCALES) {
  const m = messages(l).AgentUrl;
  assert.equal(m.desc, DESC[l], `${l}.AgentUrl.desc`);
  assert.equal(m.urlHint, URL_HINT[l], `${l}.AgentUrl.urlHint`);
}

// 2. The hint names the page with the sidebar's exact label.
for (const l of LOCALES) {
  const nav = messages(l).DashboardNav.myAgent;
  assert.ok(typeof nav === "string" && nav !== "", `${l}.DashboardNav.myAgent exists`);
  assert.ok(messages(l).AgentUrl.urlHint.includes(nav), `${l}: urlHint names "${nav}"`);
}

// 3. No positional reference anywhere in the AgentUrl namespace.
const POSITIONAL = /ci-dessus|plus haut|au-dessus|\babove\b|למעלה/i;
for (const l of LOCALES) {
  for (const [k, v] of Object.entries(messages(l).AgentUrl as Record<string, string>))
    assert.doesNotMatch(v, POSITIONAL, `${l}.AgentUrl.${k}: no "above"`);
}

console.log("agent-url-copy: ok");
