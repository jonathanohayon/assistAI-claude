// The public agent URL card ("API : utiliser l'agent Tamara depuis votre
// propre téléphonie") on /dashboard/settings is level-3
// content: rendered only in developer mode, admins always (showLevel3).
// Renders the REAL gate to static HTML in fr/en/he. Mock data only.
// Run with:  npx tsx scripts/tests/agent-url-dev-mode.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentUrlCardGate } from "../../app/[locale]/dashboard/settings/agent-url-section";
import { showLevel3 } from "../../components/bricks/level3";
import { showLevel3 as voiceShowLevel3 } from "../../components/bricks/voice/voice-ui";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
const esc = (s: string) => s.replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const render = (locale: string, isAdmin: boolean, developerMode: boolean) =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps,
      createElement(AgentUrlCardGate, { isAdmin, developerMode }),
    ),
  );

// 1. One rule for every screen: the settings card uses the bricks' level-3 rule.
assert.equal(voiceShowLevel3, showLevel3, "VoiceBrick and settings share one showLevel3");

// 2. The gate: off = nothing in the DOM; on (or admin) = the card.
for (const l of LOCALES) {
  const m = messages(l).AgentUrl;
  assert.equal(render(l, false, false), "", `${l}: tenant, developer mode off -> nothing`);
  for (const [isAdmin, dev] of [[false, true], [true, false], [true, true]] as const) {
    const html = render(l, isAdmin, dev);
    assert.ok(html.includes(esc(m.title)), `${l} admin=${isAdmin} dev=${dev}: title`);
    assert.ok(html.includes(esc(m.contractTitle)), `${l}: contract box`);
    // Before the status GET resolves the card shows a loading line; the URL
    // states (create / once / hint) are covered by agent-url-once.test.ts.
    assert.ok(html.includes(esc(m.loading)), `${l}: loading state`);
    // The code sample stays left-to-right, also in Hebrew.
    assert.match(html, /<pre dir="ltr"/, `${l}: sample ltr`);
    assert.ok(html.includes(esc(m.urlPlaceholder)), `${l}: placeholder in the sample`);
  }
}
// Hebrew renders Hebrew, not the French copy.
{
  const he = render("he", false, true);
  for (const fr of ["API : utiliser", "téléphonie", "Copier", "Régénérer", "Contrat attendu", "URL publique", "<votre-url>"])
    assert.ok(!he.includes(esc(fr)), `he: no French "${fr}"`);
  assert.match(he, /[֐-׿]/, "he: Hebrew text");
}

// 3. No hard-coded French left in the component or on the page. The card
// lives in Réglages (/dashboard/settings), with the other level-3 card (the
// API key), since 23/11 (VP); "Connecter votre agent" no longer mounts it.
{
  const src = read("app/[locale]/dashboard/settings/agent-url-section.tsx");
  const page = read("app/[locale]/dashboard/settings/page.tsx");
  for (const f of ["app/[locale]/dashboard/agent/page.tsx", "app/[locale]/dashboard/agent/connect-owned.tsx", "app/admin/users/[userId]/agent/page.tsx"])
    assert.doesNotMatch(read(f).replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""), /AgentUrlCard|agent-url-section/, `${f}: the card is no longer on the Connect page`);
  for (const fr of ["Agent joignable", "API : utiliser", "Copier", "Copié", "Régénérer", "Contrat attendu", "Collez-la", "Toute personne", "votre-url", "sous 2 s"]) {
    assert.ok(!src.includes(fr), `component: no hard-coded "${fr}"`);
    assert.ok(!page.includes(fr), `page: no hard-coded "${fr}"`);
  }
  // The settings page renders the gated card (same isAdmin as the API key), never the bare section.
  assert.match(page, /import \{ AgentUrlCard \} from "\.\/agent-url-section";/);
  assert.match(page, /<ApiKeyCard isAdmin=\{isAdmin\} \/>[\s\S]*?<AgentUrlCard isAdmin=\{isAdmin\} \/>/, "next to the API key, the level-3 group");
  assert.match(page, /const isAdmin = me\.role === "admin";/);
  assert.doesNotMatch(page, /<AgentUrlSection/);
  // Its anchor, for any link to it.
  assert.match(src, /<section\s+id="agent-url"\s+aria-labelledby="agent-url-title"/);
}

// 4. French copy kept exactly; same keys in the three languages.
{
  const fr = messages("fr").AgentUrl;
  assert.equal(fr.title, "API : utiliser l'agent Tamara depuis votre propre téléphonie");
  assert.equal(messages("en").AgentUrl.title, "API: use the Tamara agent from your own phone system");
  // [HE] to confirm: plural address ("שלכם"), the name in Latin.
  assert.equal(messages("he").AgentUrl.title, "API: שימוש בסוכן של Tamara ממערכת הטלפוניה שלכם");
  // desc, urlHint, emptyText, urlLabel and warning are pinned in agent-url-copy.test.ts.
  assert.equal(fr.contractTitle, "Contrat attendu par les clients vocaux");
  assert.deepEqual([fr.copy, fr.copied, fr.rotate, fr.urlPlaceholder, fr.replyWithin], ["Copier", "Copié", "Régénérer", "<votre-url>", "sous 2 s"]);
  const keys = Object.keys(fr).sort();
  for (const l of ["en", "he"]) {
    const m = messages(l).AgentUrl;
    assert.deepEqual(Object.keys(m).sort(), keys, `${l}: same AgentUrl keys as fr`);
    for (const k of keys) assert.ok(typeof m[k] === "string" && m[k].trim() !== "", `${l}.${k}: non-empty`);
  }
  for (const k of keys.filter((k) => k !== "urlPlaceholder"))
    assert.match(messages("he").AgentUrl[k], /[֐-׿]/, `he.${k}: Hebrew`);
}

console.log("agent-url-dev-mode: ok");
