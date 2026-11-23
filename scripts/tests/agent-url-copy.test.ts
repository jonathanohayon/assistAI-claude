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
  fr: "Collez-la dans votre service vocal : il interrogera l'agent Tamara pour savoir quoi répondre. Elle utilise la personnalité réglée dans Mon agent.",
  en: "Paste it into your voice service: it will ask the Tamara agent what to reply. It uses the personality set in My agent.",
  // [HE] to confirm: plural address ("הדביקו", "שלכם"), page named in quotes.
  he: 'הדביקו אותה בשירות הקולי שלכם: הוא יפנה לסוכן של תמרה כדי לדעת מה לענות. היא משתמשת באישיות שהוגדרה בדף "הסוכן שלי".',
};
const EMPTY_TEXT = {
  fr: "Aucune URL pour l'instant : créez-la pour que votre service vocal puisse interroger l'agent Tamara.",
  en: "No URL yet: create one so your voice service can query the Tamara agent.",
  // [HE] to confirm: plural address ("צרו", "שלכם").
  he: "עדיין אין כתובת: צרו אחת כדי שהשירות הקולי שלכם יוכל לפנות לסוכן של תמרה.",
};

// 1. Exact strings, three languages.
for (const l of LOCALES) {
  const m = messages(l).AgentUrl;
  assert.equal(m.desc, DESC[l], `${l}.AgentUrl.desc`);
  assert.equal(m.urlHint, URL_HINT[l], `${l}.AgentUrl.urlHint`);
  assert.equal(m.emptyText, EMPTY_TEXT[l], `${l}.AgentUrl.emptyText`);
}

// 1b. The rewritten lines name "the Tamara agent", never "your agent".
const YOUR_AGENT = /votre agent|your agent|הסוכן שלכם/i;
for (const l of LOCALES) {
  for (const k of ["desc", "urlHint", "emptyText"])
    assert.doesNotMatch(messages(l).AgentUrl[k], YOUR_AGENT, `${l}.AgentUrl.${k}: no "your agent"`);
}

// 1c. The contract samples on Réglages (agent URL card, API key card) scroll
// inside their own box, with an edge shadow while more content is hidden
// (overlay scrollbars stay invisible), instead of looking cut at 390px.
for (const f of ["app/[locale]/dashboard/settings/agent-url-section.tsx", "app/[locale]/dashboard/settings/api-key-section.tsx"]) {
  const src = readFileSync(join(ROOT, f), "utf8");
  const pres = [...src.matchAll(/<pre\b[^>]*className="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(pres.length, 1, `${f}: one <pre>`);
  for (const c of ["overflow-x-auto", "max-w-full", "scroll-visible", "scroll-shadow-x"])
    assert.ok(pres[0].split(/\s+/).includes(c), `${f}: <pre> has ${c}`);
}
{
  const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
  const rule = css.match(/\.scroll-shadow-x\s*\{([^}]*)\}/);
  assert.ok(rule, "globals.css defines .scroll-shadow-x");
  assert.match(rule[1], /no-repeat local[\s\S]*no-repeat local[\s\S]*no-repeat scroll[\s\S]*no-repeat scroll/, "covers move with the content, shadows stay at the edges");
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
