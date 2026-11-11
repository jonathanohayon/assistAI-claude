// "API & developer access" (API key card) on /dashboard/settings is level-3
// content: rendered only in developer mode, admins always (showLevel3).
// Renders the REAL gate to static HTML in fr/en/he. Mock data only, no key.
// Run with:  npx tsx scripts/tests/api-key-dev-mode.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ApiKeyCardGate } from "../../app/[locale]/dashboard/settings/api-key-section";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const PLACEHOLDER = { fr: "<VOTRE_CLE>", en: "<YOUR_KEY>", he: "<המפתח_שלך>" } as const;

// Any i18n error (e.g. a placeholder parsed as a rich-text tag) fails the test.
const render = (locale: string, isAdmin: boolean, developerMode: boolean) =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      {
        locale,
        messages: messages(locale),
        timeZone: "UTC",
        onError: (e: Error) => {
          throw e;
        },
      } as unknown as ProviderProps,
      createElement(ApiKeyCardGate, { isAdmin, developerMode }),
    ),
  );

// 1. The gate in all 4 admin x developer-mode combinations.
for (const l of LOCALES) {
  const m = messages(l).DashboardSettings;
  assert.equal(render(l, false, false), "", `${l}: tenant, developer mode off -> nothing`);
  for (const [isAdmin, dev] of [[false, true], [true, false], [true, true]] as const) {
    const html = render(l, isAdmin, dev);
    assert.ok(html.includes(esc(m.apiSection)), `${l} admin=${isAdmin} dev=${dev}: title`);
    assert.ok(html.includes(esc(m.apiDesc)), `${l}: description`);
    assert.ok(html.includes(esc(m.apiNoKey)), `${l}: no-key state`);
    assert.ok(html.includes(`>${esc(m.apiGenerate)}<`), `${l}: generate button`);
    assert.ok(html.includes(esc(m.apiEndpointLabel)), `${l}: endpoint label`);
    // URL and curl sample stay left-to-right and monospace, also in Hebrew.
    assert.match(html, /<code dir="ltr" class="[^"]*font-mono/, `${l}: url ltr mono`);
    assert.match(html, /<pre dir="ltr" class="[^"]*font-mono/, `${l}: sample ltr mono`);
    // 3. The placeholder per locale, inside the curl sample.
    const pre = html.slice(html.indexOf("<pre"), html.indexOf("</pre>"));
    assert.ok(pre.includes(`Bearer ${esc(PLACEHOLDER[l])}`), `${l}: placeholder ${PLACEHOLDER[l]} in the sample`);
    for (const other of LOCALES.filter((o) => o !== l))
      assert.ok(!pre.includes(esc(PLACEHOLDER[other])), `${l}: no ${other} placeholder`);
  }
}

// Hebrew renders Hebrew, not the French copy.
{
  const he = render("he", false, true);
  for (const fr of ["API & accès", "Aucune clé", "Générer", "Point d’accès", "VOTRE_CLE", "Paramètres"])
    assert.ok(!he.includes(esc(fr)), `he: no French "${fr}"`);
  assert.match(he, /[֐-׿]/, "he: Hebrew text");
}

// 2. The fetch lives inside the gated component; the page renders the gate.
{
  const src = read("app/[locale]/dashboard/settings/api-key-section.tsx");
  const page = read("app/[locale]/dashboard/settings/page.tsx");
  const gateStart = src.indexOf("export function ApiKeyCardGate");
  const sectionStart = src.indexOf("export function ApiKeySection");
  assert.ok(gateStart > 0 && sectionStart > gateStart, "gate defined before the section");
  const outer = src.slice(0, sectionStart);
  const section = src.slice(sectionStart);
  assert.doesNotMatch(outer, /fetch\(/, "no fetch in the card or its gate");
  assert.match(section, /fetch\("\/api\/dashboard\/api-key"\)/, "the GET lives in ApiKeySection");
  assert.match(outer, /showLevel3\(\{ isAdmin, developerMode \}\)/, "gate uses the shared level-3 rule");
  assert.match(outer, /useDeveloperMode\(\)/, "card reads developer mode");
  assert.match(outer.slice(gateStart), /return null;[\s\S]*<ApiKeySection \/>/, "section rendered only past the gate");
  assert.match(page, /<ApiKeyCard isAdmin=\{isAdmin\} \/>/, "page renders the gated card");
  assert.doesNotMatch(page, /<ApiKeySection/, "page never renders the bare section");

  // 4. No hard-coded French (or English) copy left in the card or on the page.
  for (const s of ["VOTRE_CLE", "YOUR_KEY", "Aucune clé", "Générer", "Régénérer", "Révoquer", "Copier", "Copié", "Point d", "active depuis", "État de la clé", "Documentation rapide"]) {
    assert.ok(!src.includes(s), `component: no hard-coded "${s}"`);
    assert.ok(!page.includes(s), `page: no hard-coded "${s}"`);
  }
  assert.doesNotMatch(src, /[À-ÿ]/, "component: no accented (French) characters");
}

// 5. French copy kept exactly; same keys in the three languages.
{
  const fr = messages("fr").DashboardSettings;
  assert.equal(fr.apiSection, "API & accès développeur");
  assert.equal(fr.apiNoKey, "Aucune clé API active.");
  assert.equal(fr.apiKeyPlaceholder, "<VOTRE_CLE>");
  assert.equal(messages("en").DashboardSettings.apiKeyPlaceholder, "<YOUR_KEY>");
  assert.equal(messages("he").DashboardSettings.apiKeyPlaceholder, "<המפתח_שלך>");
  const apiKeys = (m: Record<string, unknown>) => Object.keys(m).filter((k) => k.startsWith("api")).sort();
  const keys = apiKeys(fr);
  assert.ok(keys.length === 13, "fr: api* keys present");
  for (const l of ["en", "he"]) {
    const m = messages(l).DashboardSettings;
    assert.deepEqual(apiKeys(m), keys, `${l}: same api* keys as fr`);
    for (const k of keys) assert.ok(typeof m[k] === "string" && m[k].trim() !== "", `${l}.${k}: non-empty`);
    assert.deepEqual(Object.keys(m).sort(), Object.keys(fr).sort(), `${l}: same DashboardSettings keys as fr`);
  }
  for (const k of keys) assert.match(messages("he").DashboardSettings[k], /[֐-׿]/, `he.${k}: Hebrew`);
}

console.log("api-key-dev-mode: ok");
