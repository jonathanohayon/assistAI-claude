// "Agent joignable" (public agent URL) on /dashboard/settings is level-3
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
    assert.ok(html.includes(`>${esc(m.copy)}<`) && html.includes(`>${esc(m.rotate)}<`), `${l}: buttons`);
    // URL and code sample stay left-to-right, also in Hebrew.
    assert.match(html, /<code dir="ltr"/, `${l}: url ltr`);
    assert.match(html, /<pre dir="ltr"/, `${l}: sample ltr`);
    assert.ok(html.includes(esc(m.urlPlaceholder)), `${l}: placeholder in the sample`);
  }
}
// Hebrew renders Hebrew, not the French copy.
{
  const he = render("he", false, true);
  for (const fr of ["Agent joignable", "Copier", "Régénérer", "Contrat attendu", "URL publique", "<votre-url>"])
    assert.ok(!he.includes(esc(fr)), `he: no French "${fr}"`);
  assert.match(he, /[֐-׿]/, "he: Hebrew text");
}

// 3. No hard-coded French left in the component or on the page.
{
  const src = read("app/[locale]/dashboard/settings/agent-url-section.tsx");
  const page = read("app/[locale]/dashboard/settings/page.tsx");
  for (const fr of ["Agent joignable", "Copier", "Copié", "Régénérer", "Contrat attendu", "Collez-la", "Toute personne", "votre-url", "sous 2 s"]) {
    assert.ok(!src.includes(fr), `component: no hard-coded "${fr}"`);
    assert.ok(!page.includes(fr), `page: no hard-coded "${fr}"`);
  }
  // The page renders the gated card, never the bare section.
  assert.match(page, /<AgentUrlCard isAdmin=\{isAdmin\} \/>/);
  assert.doesNotMatch(page, /<AgentUrlSection/);
}

// 4. French copy kept exactly; same keys in the three languages.
{
  const fr = messages("fr").AgentUrl;
  assert.equal(fr.title, "Agent joignable");
  assert.equal(fr.desc, "Donnez à votre agent une voix et un numéro depuis un service vocal externe, en lui fournissant cette URL.");
  assert.equal(fr.urlLabel, "URL publique de votre agent");
  assert.equal(fr.urlHint, "Collez-la dans un service vocal pour que votre agent réponde au téléphone. Elle utilise la persona configurée ci-dessus.");
  assert.equal(fr.warning, "Toute personne disposant de cette URL peut faire parler votre agent. Elle ne donne accès ni à vos transcripts ni à votre compte.");
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
