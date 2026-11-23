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
  // [HE] to confirm: plural address ("שלכם"), the name in Latin.
  he: "השירות הקולי שלכם פונה לסוכן של Tamara בכל תור דיבור, באמצעות הכתובת הזו.",
};
const URL_HINT = {
  fr: "Collez-la dans votre service vocal : il interrogera l'agent Tamara pour savoir quoi répondre. Elle utilise la personnalité réglée dans Mon agent.",
  en: "Paste it into your voice service: it will ask the Tamara agent what to reply. It uses the personality set in My agent.",
  // [HE] to confirm: plural address ("הדביקו", "שלכם"), page named in quotes, the name in Latin.
  he: 'הדביקו אותה בשירות הקולי שלכם: הוא יפנה לסוכן של Tamara כדי לדעת מה לענות. היא משתמשת באישיות שהוגדרה בדף "הסוכן שלי".',
};
const EMPTY_TEXT = {
  fr: "Aucune URL pour l'instant : créez-la pour que votre service vocal puisse interroger l'agent Tamara.",
  en: "No URL yet: create one so your voice service can query the Tamara agent.",
  // [HE] to confirm: plural address ("צרו", "שלכם"), the name in Latin.
  he: "עדיין אין כתובת: צרו אחת כדי שהשירות הקולי שלכם יוכל לפנות לסוכן של Tamara.",
};
const URL_LABEL = {
  fr: "URL publique de l'agent Tamara",
  en: "Public URL of the Tamara agent",
  // [HE] to confirm: the name in Latin.
  he: "הכתובת הציבורית של הסוכן של Tamara",
};
const WARNING = {
  fr: "Toute personne disposant de cette URL peut faire parler l'agent Tamara. Elle ne donne accès ni à vos transcripts ni à votre compte.",
  en: "Anyone with this URL can make the Tamara agent speak. It gives no access to your transcripts or your account.",
  // [HE] to confirm: plural address ("שלכם"), the name in Latin.
  he: "כל מי שיש לו את הכתובת הזו יכול לגרום לסוכן של Tamara לדבר. היא לא נותנת גישה לתמלולים או לחשבון שלכם.",
};

// 1. Exact strings, three languages.
for (const l of LOCALES) {
  const m = messages(l).AgentUrl;
  assert.equal(m.desc, DESC[l], `${l}.AgentUrl.desc`);
  assert.equal(m.urlHint, URL_HINT[l], `${l}.AgentUrl.urlHint`);
  assert.equal(m.emptyText, EMPTY_TEXT[l], `${l}.AgentUrl.emptyText`);
  assert.equal(m.urlLabel, URL_LABEL[l], `${l}.AgentUrl.urlLabel`);
  assert.equal(m.warning, WARNING[l], `${l}.AgentUrl.warning`);
}

// 1b. In this card the agent is always "the Tamara agent", never "your
// agent": every AgentUrl key, three languages (HE with or without a prefix).
const YOUR_AGENT = /votre agent|your agent|סוכן שלכם/i;
for (const l of LOCALES) {
  for (const [k, v] of Object.entries(messages(l).AgentUrl as Record<string, string>))
    assert.doesNotMatch(v, YOUR_AGENT, `${l}.AgentUrl.${k}: no "your agent"`);
}

// 1d. Hebrew writes the brand in Latin, "Tamara", never "תמרה" (any prefix).
// Scanned over every string of he.json; enforced for AgentUrl here (the
// trial e-mails are enforced in trial-paused-email.test.ts). The other
// namespaces still have it (95 strings on 23/11), left for a separate PR.
{
  const hits: string[] = [];
  const walk = (o: Record<string, unknown>, p: string) => {
    for (const [k, v] of Object.entries(o)) {
      const q = p ? `${p}.${k}` : k;
      if (typeof v === "string") {
        if (/תמרה/.test(v)) hits.push(q);
      } else if (v && typeof v === "object") walk(v as Record<string, unknown>, q);
    }
  };
  walk(messages("he"), "");
  const ENFORCED = ["AgentUrl.", "Email.trialDeleted.", "Email.trialWarning."];
  const bad = hits.filter((k) => ENFORCED.some((p) => k.startsWith(p)));
  assert.deepEqual(bad, [], `he: "תמרה" instead of "Tamara" in ${bad.join(", ")}`);
  for (const k of ["title", "desc", "urlHint", "emptyText", "urlLabel", "warning"])
    assert.match(messages("he").AgentUrl[k], /Tamara/, `he.AgentUrl.${k}: "Tamara" in Latin`);
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
