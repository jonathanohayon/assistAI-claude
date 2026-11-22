// ADMIN-ONLY engine override screens: the catalogue "Moteur imposé" lines
// (app/admin/engine-override/ProductCatalogueForm.tsx) and the tenant banner
// line (app/admin/users/[userId]/EngineOverrideLine.tsx). Render tests on the
// real server option data (engineOptionCoverage + honouredOptions), the PUT
// payloads, the 400 field mapping, and the import guard (no tenant file
// imports these modules).
// Run with:  npx tsx scripts/tests/engine-override-admin-ui.test.ts

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EngineChoiceRow } from "../../app/admin/engine-override/EngineChoiceRow";
import { ProductCatalogueForm } from "../../app/admin/engine-override/ProductCatalogueForm";
import {
  NOT_HONOURED_LINE,
  PRODUCT_LANGUAGES,
  catalogueFieldErrors,
  cataloguePutBody,
  costLabel,
  missingLanguages,
  putJson,
  salesFieldErrors,
  salesPutBody,
  type BannerEngineData,
  type CatalogueEngineData,
  type EngineOption,
} from "../../app/admin/engine-override/engine-ui";
import { EngineOverridePanel, salesLanguages, type EngineLineData } from "../../app/admin/users/[userId]/EngineOverrideLine";
import { DEFAULT_ENGINE_LANGUAGES, type EngineLanguages } from "../../lib/engine-languages";
import { engineOptionCoverage, noEngineOverrides } from "../../lib/engine-override";
import { DEFAULT_COST_RATES } from "../../lib/finance/rates";
import { PRODUCTS } from "../../lib/product-values";
import { REPO_ROOT, assertScanRead, scanSources } from "./helpers/source-scan";

// renderToStaticMarkup escapes apostrophes / quotes.
const unescape = (h: string) => h.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => unescape(renderToStaticMarkup(el));

const optionsFor = (languages: EngineLanguages = DEFAULT_ENGINE_LANGUAGES) =>
  Object.fromEntries(PRODUCTS.map((p) => [p, { options: engineOptionCoverage(p, languages) }])) as CatalogueEngineData["engineOptions"];
const catalogue = (over: Partial<CatalogueEngineData["engineOverrides"]> = {}, languages?: EngineLanguages): CatalogueEngineData => ({
  engineOverrides: { ...noEngineOverrides(), ...over },
  engineOptions: optionsFor(languages),
});
const rates = { perMinuteUsd: DEFAULT_COST_RATES.perMinuteUsd, openaiUsdPerMinute: DEFAULT_COST_RATES.openaiUsdPerMinute };
const renderCatalogue = (d: CatalogueEngineData, r: typeof rates | null = rates) => html(createElement(ProductCatalogueForm, { initial: d, rates: r }));

/** The HTML of one data-engine-row (up to the next one). */
function rowOf(h: string, label: string): string {
  const i = h.indexOf(`data-engine-row="${label}"`);
  assert.ok(i >= 0, `row ${label} rendered`);
  const j = h.indexOf("data-engine-row=", i + 10);
  return h.slice(i, j < 0 ? undefined : j);
}
const optionTags = (h: string) => [...h.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map((m) => ({ attrs: m[1]!, label: m[2]! }));
const isDisabled = (h: string, label: string) => {
  const o = optionTags(h).find((x) => x.label === label);
  assert.ok(o, `option ${label} rendered`);
  return /\bdisabled=""/.test(o.attrs);
};

const pending: Promise<void>[] = [];

// ── 1. Catalogue: disabled non-honoured options, with the ONE line ─────────
{
  const h = renderCatalogue(catalogue());
  assert.match(h, /Catalogue des produits/);
  const reception = rowOf(h, "Réception");
  const sales = rowOf(h, "Ventes");
  const connect = rowOf(h, "Connecter votre agent");
  // Réception: every engine honoured (Gemini / Grok on the worker's env model).
  for (const e of ["OpenAI", "Gemini", "Grok (xAI)"]) assert.equal(isDisabled(reception, e), false, `reception ${e} enabled`);
  assert.doesNotMatch(reception, /data-not-honoured/);
  // Ventes: OpenAI only.
  assert.equal(isDisabled(sales, "OpenAI"), false);
  assert.equal(isDisabled(sales, "Gemini"), true);
  assert.equal(isDisabled(sales, "Grok (xAI)"), true);
  assert.match(sales, new RegExp(`Grisé \\(Gemini, Grok \\(xAI\\)\\) : ${NOT_HONOURED_LINE.replace(/\./g, "\\.")}`));
  assert.equal((sales.match(/data-not-honoured/g) ?? []).length, 1, "one line per row");
  // Connecter votre agent: nothing honoured.
  for (const e of ["OpenAI", "Gemini", "Grok (xAI)"]) assert.equal(isDisabled(connect, e), true, `connect ${e} disabled`);
  assert.match(connect, /Pas encore pris en charge pour ce produit\./);
  // "Aucun (choix du compte)" on every line, always selectable.
  for (const r of [reception, sales, connect]) assert.equal(isDisabled(r, "Aucun (choix du compte)"), false);
  // No selection → no cost, no warning.
  assert.doesNotMatch(h, /data-cost|data-language-warning/);
}

// Reception with Gemini: a forced model other than the env one is disabled (one line names it).
{
  const opts: EngineOption[] = [
    ...engineOptionCoverage("reception", DEFAULT_ENGINE_LANGUAGES),
    { engine: "gemini", model: "gemini-other", honoured: false, languages: ["fr", "en"] },
  ];
  const h = html(
    createElement(EngineChoiceRow, { label: "R", options: opts, choice: { engine: "gemini", model: null }, onChange: () => {}, costPerMinUsd: null, warning: null }),
  );
  assert.equal(isDisabled(h, "gemini-other"), true);
  assert.equal(isDisabled(h, "modèle par défaut du moteur"), false);
  assert.match(h, /Grisé \(Gemini · gemini-other\) : Pas encore pris en charge pour ce produit\./);
}

// ── 2. Language warning (catalogue: every product language) ────────────────
{
  // Gemini: fr/en only, Hebrew unknown → NOT supported → warning.
  const g = rowOf(renderCatalogue(catalogue({ reception: { engine: "gemini", model: null } })), "Réception");
  assert.match(g, /data-language-warning/);
  assert.match(g, /ne parle pas : hébreu \(langue inconnue = non prise en charge\)/);
  assert.match(g, /le moteur imposé sera ignoré et une alerte admin sera levée/);
  // OpenAI speaks fr/he/en → no warning.
  const o = rowOf(renderCatalogue(catalogue({ reception: { engine: "openai", model: "gpt-realtime-2.1" } })), "Réception");
  assert.doesNotMatch(o, /data-language-warning/);
  // Unknown = not supported: a model with its own EMPTY entry speaks nothing.
  const t: EngineLanguages = structuredClone(DEFAULT_ENGINE_LANGUAGES);
  t.openai["gpt-realtime-2.1"] = [];
  const u = rowOf(renderCatalogue(catalogue({ sales: { engine: "openai", model: "gpt-realtime-2.1" } }, t)), "Ventes");
  assert.match(u, /ne parle pas : français, hébreu, anglais/);
  // An option absent from the server data → speaks nothing.
  assert.deepEqual(missingLanguages([], { engine: "openai", model: "ghost" }, PRODUCT_LANGUAGES), ["fr", "he", "en"]);
  assert.deepEqual(missingLanguages([], null, PRODUCT_LANGUAGES), []);
}

// ── 3. Cost: "estimation" next to every figure, "—" when none ──────────────
{
  assert.equal(costLabel(null), "—");
  assert.equal(costLabel(undefined), "—");
  assert.match(costLabel(0.08), /^0,08 \$\/min · estimation$/);
  const h = renderCatalogue(
    catalogue({ reception: { engine: "gemini", model: null }, sales: { engine: "openai", model: null } }),
  );
  // Gemini: no per-minute figure anywhere → "—", never a number.
  assert.match(rowOf(h, "Réception"), /data-cost[^>]*>—</);
  // OpenAI: the rate card's per-minute fallback, an estimation.
  assert.match(rowOf(h, "Ventes"), new RegExp(`data-cost[^>]*>0,${String(DEFAULT_COST_RATES.openaiUsdPerMinute).split(".")[1]}0? \\$/min · estimation<`));
  // Grok: 0.08 from the rate card defaults.
  const x = rowOf(renderCatalogue(catalogue({ reception: { engine: "xai", model: null } })), "Réception");
  assert.match(x, /data-cost[^>]*>0,08 \$\/min · estimation</);
  // Rate card unavailable → "—".
  assert.match(rowOf(renderCatalogue(catalogue({ sales: { engine: "openai", model: null } }), null), "Ventes"), /data-cost[^>]*>—</);
}

// ── 4. Catalogue PUT payloads (set / clear / omitted) ──────────────────────
{
  const stored = { ...noEngineOverrides(), sales: { engine: "openai" as const, model: "gpt-realtime-2.1" } };
  // set reception → both reception products, nothing else, no price field.
  assert.deepEqual(cataloguePutBody(stored, { reception: { engine: "xai", model: null }, sales: stored.sales, connect: null }), {
    catalogue: { reception: { engineOverride: { engine: "xai", model: null } }, reception_multi: { engineOverride: { engine: "xai", model: null } } },
  });
  // clear sales.
  assert.deepEqual(cataloguePutBody(stored, { reception: null, sales: null, connect: null }), { catalogue: { sales: { engineOverride: null } } });
  // unchanged / omitted → nothing sent.
  assert.deepEqual(cataloguePutBody(stored, { reception: null, sales: { engine: "openai", model: "gpt-realtime-2.1" }, connect: null }), { catalogue: {} });
  assert.deepEqual(cataloguePutBody(stored, {}), { catalogue: {} });
}

// ── 5. Banner: resolved engine per product, source in plain French ─────────
const banner = (over: Partial<BannerEngineData> = {}, languages?: EngineLanguages): EngineLineData => ({
  engine: {
    userId: "u1",
    salesOverride: null,
    products: [
      { entry: "reception", product: "reception", language: "he", resolved: { engine: "openai", model: "gpt-realtime-2", source: "default" }, costPerMinUsd: 0.3, ignored: { reason: "language", wanted: { source: "product", engine: "gemini", model: null } } },
      { entry: "sales", product: "sales", language: "fr", resolved: { engine: "openai", model: "gpt-realtime-2.1", source: "product" }, costPerMinUsd: null },
      { entry: "connect", product: "connect", resolved: null, costPerMinUsd: null },
    ],
    ...over,
  },
  options: { reception: engineOptionCoverage("reception", languages ?? DEFAULT_ENGINE_LANGUAGES), sales: engineOptionCoverage("sales", languages ?? DEFAULT_ENGINE_LANGUAGES) },
  rates,
});
const renderBanner = (d: EngineLineData, extra: Record<string, unknown> = {}) =>
  html(createElement(EngineOverridePanel, { userId: "u1", data: d, defaultOpen: true, ...extra }));
{
  const h = renderBanner(banner());
  assert.match(h, /Réception<\/span> : <span[^>]*><strong[^>]*>OpenAI · gpt-realtime-2<\/strong> · <span data-source="true">choix du compte<\/span> · <span data-cost="true">0,30 \$\/min · estimation/);
  assert.match(h, /OpenAI · gpt-realtime-2\.1<\/strong> · <span data-source="true">imposé pour le produit<\/span> · <span data-cost="true">—</);
  assert.match(h, /Connecter votre agent<\/span> : l'agent du client répond, aucun moteur imposé\./);
  // The server's ignored flag, in French.
  assert.match(h, /data-ignored[^>]*>Moteur imposé ignoré \(Gemini · modèle par défaut du moteur\) : il ne parle pas hébreu\. Une alerte admin est levée à l'appel\./);
  // The client setting is the existing one, linked.
  assert.match(h, /href="\/admin\/users\/u1\/my-agent\?tile=voice"/);
  const c = renderBanner(banner({ products: [{ entry: "reception", product: "reception", language: "fr", resolved: { engine: "xai", model: "grok-voice-3.0", source: "client" }, costPerMinUsd: 0.08 }] }));
  assert.match(c, /data-source="true">imposé pour ce client</);
  assert.doesNotMatch(c, /ne parle pas/);
  // Client setting that doesn't speak the account language: said (it still applies).
  const ch = renderBanner(banner({ products: [{ entry: "reception", product: "reception", language: "he", resolved: { engine: "xai", model: "grok-voice-3.0", source: "client" }, costPerMinUsd: 0.08 }] }));
  assert.match(ch, /Ce moteur ne parle pas hébreu .*le réglage du client s'applique quand même/);
}

// ── 6. Banner Ventes: only OpenAI selectable; warning; PUT payloads ────────
{
  const h = renderBanner(banner());
  const v = rowOf(h, "Ventes : imposé pour ce client");
  assert.equal(isDisabled(v, "OpenAI"), false);
  assert.equal(isDisabled(v, "Gemini"), true);
  assert.equal(isDisabled(v, "Grok (xAI)"), true);
  assert.match(v, /Grisé \(Gemini, Grok \(xAI\)\) : Pas encore pris en charge pour ce produit\./);
  assert.equal(isDisabled(v, "Aucun (pas de moteur imposé pour ce client)"), false);
  assert.doesNotMatch(v, /data-language-warning/);

  // Language warning on the account's sales languages (byLanguage), unknown = not supported.
  const t: EngineLanguages = structuredClone(DEFAULT_ENGINE_LANGUAGES);
  t.openai["gpt-realtime-2.1"] = ["fr", "en"];
  const he = banner(
    {
      products: [
        {
          entry: "sales", product: "sales", language: "fr", resolved: { engine: "openai", model: "gpt-realtime-2", source: "default" }, costPerMinUsd: 0.3,
          byLanguage: [
            { language: "fr", resolved: { engine: "openai", model: "gpt-realtime-2", source: "default" }, costPerMinUsd: 0.3 },
            { language: "he", resolved: { engine: "openai", model: "gpt-realtime-2", source: "default" }, costPerMinUsd: 0.3 },
          ],
        },
      ],
    },
    t,
  );
  assert.deepEqual(salesLanguages(he.engine.products), ["fr", "he"]);
  const w = rowOf(renderBanner(he, { initialSalesChoice: { engine: "openai", model: "gpt-realtime-2.1" } }), "Ventes : imposé pour ce client");
  assert.match(w, /data-language-warning[^>]*>Ce moteur ne parle pas : hébreu \(langue inconnue = non prise en charge\)\. Pour ce compte, le moteur imposé sera ignoré et une alerte admin sera levée\./);
  assert.match(w, /data-cost[^>]*>0,30 \$\/min · estimation</);
  const ok = rowOf(renderBanner(he, { initialSalesChoice: { engine: "openai", model: "gpt-realtime-2" } }), "Ventes : imposé pour ce client");
  assert.doesNotMatch(ok, /data-language-warning/);
  // No sales product → the call path's fallback "fr".
  assert.deepEqual(salesLanguages([]), ["fr"]);

  // PUT payloads.
  const set = { engine: "openai" as const, model: "gpt-realtime-2.1" };
  assert.deepEqual(salesPutBody(null, set), { salesOverride: set });
  assert.deepEqual(salesPutBody(set, null), { salesOverride: null });
  assert.deepEqual(salesPutBody(set, { engine: "openai", model: "gpt-realtime-2.1" }), {});
  assert.ok(!("salesOverride" in salesPutBody(null, null)), "unchanged: salesOverride omitted");
}

// ── 7. 400 fields inline, 404 plain ────────────────────────────────────────
{
  assert.deepEqual(salesFieldErrors(["salesOverride.engine"]), { engine: "Moteur refusé par le serveur." });
  assert.deepEqual(salesFieldErrors(["salesOverride.model", "salesOverride"]), { model: "Modèle refusé par le serveur.", line: "Valeur refusée par le serveur (salesOverride)." });
  const e = catalogueFieldErrors(["catalogue.reception_multi.engineOverride.model", "catalogue.sales.engineOverride.engine", "catalogue.connect.engineOverride", "catalogue.x.EUR"]);
  assert.deepEqual(e.byEntry, {
    reception: { model: "Modèle refusé par le serveur." },
    sales: { engine: "Moteur refusé par le serveur." },
    connect: { line: "Valeur refusée par le serveur." },
  });
  assert.deepEqual(e.other, ["catalogue.x.EUR"]);

  // Rendered next to the field: the engine error sits right after the engine select.
  const v = rowOf(renderBanner(banner(), { initialSalesChoice: { engine: "openai", model: null }, initialErrors: { engine: "Moteur refusé par le serveur.", model: "Modèle refusé par le serveur." } }), "Ventes : imposé pour ce client");
  assert.match(v, /data-field="engine"[^>]*aria-invalid="true"[\s\S]*?<\/select><p role="alert"[^>]*>Moteur refusé par le serveur\.<\/p>/);
  assert.match(v, /data-field="model"[^>]*aria-invalid="true"[\s\S]*?<\/select><p role="alert"[^>]*>Modèle refusé par le serveur\.<\/p>/);

  // putJson: 400 fields / 404 / ok, with the body sent as JSON.
  const fake = (status: number, json: unknown, seen: unknown[] = []) =>
    (async (url: string, init: RequestInit) => {
      seen.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(json), { status });
    }) as unknown as typeof fetch;
  const seen: unknown[] = [];
  const run = async () => {
    assert.deepEqual(await putJson(fake(400, { error: "invalid_engine_override", fields: ["salesOverride.engine"] }, seen), "/api/admin/users/u1/engine", { salesOverride: { engine: "gemini", model: null } }), {
      ok: false,
      kind: "fields",
      fields: ["salesOverride.engine"],
    });
    assert.deepEqual(seen[0], { url: "/api/admin/users/u1/engine", method: "PUT", body: { salesOverride: { engine: "gemini", model: null } } });
    assert.deepEqual(await putJson(fake(404, { error: "user_not_found" }), "/x", {}), { ok: false, kind: "not_found" });
    const ok = await putJson(fake(200, { ok: true, salesOverride: null }), "/x", { salesOverride: null });
    assert.equal(ok.ok, true);
  };
  pending.push(run());
}

// ── 8. Import guard: no tenant file imports these admin modules ────────────
{
  const scan = scanSources(["app", "components", "lib", "i18n", "proxy.ts"], { ext: /\.(ts|tsx|mjs|js)$/ });
  assertScanRead(scan, "engine-admin-imports", {
    minFiles: 300,
    sentinels: ["app/admin/admin-shell.tsx", "app/admin/users/[userId]/layout.tsx", "app/[locale]/dashboard/config-form.tsx"],
  });
  const ADMIN_MODULE = /(?:from\s+|import\(\s*)["'][^"']*\/(?:engine-ui|EngineChoiceRow|ProductCatalogueForm|EngineOverrideLine)["']/;
  const importers = scan.files.filter((f) => ADMIN_MODULE.test(scan.text.get(f) ?? ""));
  assert.deepEqual(importers.sort(), [
    "app/admin/admin-shell.tsx",
    "app/admin/engine-override/EngineChoiceRow.tsx",
    "app/admin/engine-override/ProductCatalogueForm.tsx",
    "app/admin/users/[userId]/EngineOverrideLine.tsx",
    "app/admin/users/[userId]/layout.tsx",
  ]);
  for (const f of importers) assert.ok(f.startsWith("app/admin/"), `${f} imports an admin engine module`);
  assert.ok(REPO_ROOT.length > 0);
}

Promise.all(pending).then(
  () => console.log("ALL ENGINE-OVERRIDE ADMIN UI TESTS PASSED"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
