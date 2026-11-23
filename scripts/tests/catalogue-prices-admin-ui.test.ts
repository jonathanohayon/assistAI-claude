// ADMIN-ONLY catalogue prices screen (app/admin/engine-override/ProductPricesForm.tsx
// + catalogue-prices-ui.ts): touched-fields patch, reception_multi add-ons
// never editable, derived annual, validation, conflict detection, the PUT
// body (driven through the REAL server merge, catalogueRowWrite), 400 →
// inline, the render, and the import guard.
// Run with:  npx tsx scripts/tests/catalogue-prices-admin-ui.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CONFIRM_LINE,
  NOT_SOLD_AS_ADDON,
  applyPatch,
  catalogueConflicts,
  deriveAnnual,
  diffSummary,
  draftErrors,
  isEditable,
  parseFieldInput,
  pricesFieldErrors,
  pricesPatch,
  pricesPutBody,
  productLabels,
  savePrices,
  type Drafts,
} from "../../app/admin/engine-override/catalogue-prices-ui";
import { ProductPricesForm } from "../../app/admin/engine-override/ProductPricesForm";
import { noEngineOverrides } from "../../lib/engine-override";
import { defaultProductCatalogue, type ProductCatalogue } from "../../lib/product-catalogue";
import { catalogueRowWrite, type CatalogueRow } from "../../lib/product-catalogue-row";
import { PRODUCTS, type ProductNames } from "../../lib/product-values";
import { REPO_ROOT, assertScanRead, scanSources } from "./helpers/source-scan";

const unescape = (h: string) => h.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const pending: Promise<void>[] = [];
// The products' names as the server passes them (lib/product-names.ts): DashboardNav, French.
const NAMES = (JSON.parse(readFileSync(`${REPO_ROOT}/messages/fr.json`, "utf8")) as { DashboardNav: ProductNames }).DashboardNav;

// ── 1. reception_multi add-ons are never editable ───────────────────────────
{
  assert.equal(isEditable("reception_multi", "addonMonthly"), false);
  for (const p of PRODUCTS) {
    for (const f of ["monthly", "minutes", "overagePerMin"] as const) assert.equal(isEditable(p, f), true, `${p}.${f}`);
    if (p !== "reception_multi") assert.equal(isEditable(p, "addonMonthly"), true, p);
  }
  // Even a forged draft on it is an error and never reaches the patch.
  const cat = defaultProductCatalogue();
  const d: Drafts = { "reception_multi.EUR.addonMonthly": "10" };
  assert.equal(draftErrors(d)["reception_multi.EUR.addonMonthly"], NOT_SOLD_AS_ADDON);
  assert.deepEqual(pricesPatch(cat, d), {});
  // Rendered as the "Non vendu en option" text: exactly two cells (EUR + ILS), no input there.
  const html = unescape(renderToStaticMarkup(createElement(ProductPricesForm, { initial: cat, names: NAMES })));
  assert.equal(html.split(NOT_SOLD_AS_ADDON).length - 1, 2);
  assert.ok(!html.includes("Réception multi-sites EUR Option, mensuel"));
  assert.ok(html.includes("Réception multi-sites EUR Prix mensuel"));
  // 4 products × 2 currencies × 4 fields − the 2 reception_multi add-ons.
  assert.equal(html.split("<input").length - 1, 30);
  // Sales minutes differ per currency on purpose and are shown as stored.
  assert.ok(html.includes('value="400"') && html.includes('value="250"'));
}

// ── 2. Validation ───────────────────────────────────────────────────────────
{
  assert.deepEqual(parseFieldInput("minutes", "250"), { ok: true, value: 250 });
  assert.equal(parseFieldInput("minutes", "250.5").ok, false);
  assert.equal(parseFieldInput("minutes", "-1").ok, false);
  assert.equal(parseFieldInput("minutes", "").ok, false);
  assert.deepEqual(parseFieldInput("overagePerMin", "0,45"), { ok: true, value: 0.45 });
  assert.deepEqual(parseFieldInput("overagePerMin", "1.9"), { ok: true, value: 1.9 });
  assert.deepEqual(parseFieldInput("monthly", "0"), { ok: true, value: 0 });
  for (const bad of ["-3", "abc", "1e3", "1.2.3", " ", "Infinity", "NaN"]) assert.equal(parseFieldInput("monthly", bad).ok, false, bad);
  const errs = draftErrors({ "sales.ILS.minutes": "2.5", "sales.EUR.overagePerMin": "-1", "connect.EUR.monthly": "59" });
  assert.equal(errs["sales.ILS.minutes"], "Nombre entier ≥ 0 attendu.");
  assert.ok(errs["sales.EUR.overagePerMin"]);
  assert.equal(errs["connect.EUR.monthly"], undefined);
  // An invalid draft never reaches the patch.
  assert.deepEqual(pricesPatch(defaultProductCatalogue(), { "sales.ILS.minutes": "2.5" }), {});
  // Rendered: annual is derived and read-only.
  const html = unescape(renderToStaticMarkup(createElement(ProductPricesForm, { initial: defaultProductCatalogue(), names: NAMES })));
  assert.ok(html.includes("Annuel : 890 €"), "annual shown derived");
}

// ── 3. Patch = touched fields only, with the derived annual ─────────────────
{
  const cat = defaultProductCatalogue();
  const patch = pricesPatch(cat, {
    "reception.EUR.monthly": "95",
    "sales.ILS.overagePerMin": "2,1",
    "connect.EUR.minutes": "100", // touched but equal to the stored value → not sent
  });
  assert.deepEqual(patch, {
    reception: { EUR: { monthly: 95, annual: 950 } },
    sales: { ILS: { overagePerMin: 2.1 } },
  });
  assert.deepEqual(pricesPatch(cat, { "sales.EUR.addonMonthly": "89.9" }), { sales: { EUR: { addonMonthly: 89.9, addonAnnual: 899 } } });
  assert.equal(deriveAnnual(8.9), 89);
  assert.equal(deriveAnnual(0.39), 3.9);
  // Minutes / overage never carry an annual.
  assert.deepEqual(pricesPatch(cat, { "sales.EUR.minutes": "500" }), { sales: { EUR: { minutes: 500 } } });

  // PUT body: { catalogue: patch } only, never an engineOverride.
  const body = pricesPutBody(patch);
  assert.deepEqual(Object.keys(body), ["catalogue"]);
  assert.ok(!JSON.stringify(body).includes("engineOverride"));

  // Through the REAL server merge: only those fields change, the engine
  // overrides are kept, and the result equals applyPatch (the screen's view).
  const stored: CatalogueRow = {
    catalogue: cat,
    engineOverrides: { ...noEngineOverrides(), sales: { engine: "openai", model: null } },
  };
  const w = catalogueRowWrite(stored, JSON.parse(JSON.stringify(body)));
  assert.ok(w.ok);
  assert.deepEqual(w.value, applyPatch(cat, patch));
  assert.deepEqual(w.engineOverrides, stored.engineOverrides);
  const changed: string[] = [];
  for (const p of PRODUCTS)
    for (const c of ["EUR", "ILS"] as const)
      for (const f of Object.keys(cat[p][c]) as (keyof ProductCatalogue["sales"]["EUR"])[])
        if (w.value[p][c][f] !== cat[p][c][f]) changed.push(`${p}.${c}.${f}`);
  assert.deepEqual(changed, ["reception.EUR.monthly", "reception.EUR.annual", "sales.ILS.overagePerMin"]);

  // Diff summary: old → new per changed field, catalogue order.
  assert.deepEqual(
    diffSummary(cat, patch, productLabels(NAMES)).map((d) => [d.path, d.from, d.to]),
    [
      ["reception.EUR.monthly", 89, 95],
      ["reception.EUR.annual", 890, 950],
      ["sales.ILS.overagePerMin", 1.9, 2.1],
    ],
  );
}

// ── 4. Conflict detection ───────────────────────────────────────────────────
{
  const a = defaultProductCatalogue();
  assert.deepEqual(catalogueConflicts(a, defaultProductCatalogue()), []);
  const b = defaultProductCatalogue();
  b.connect.ILS.minutes = 120; // an UNTOUCHED field changed elsewhere still counts
  assert.deepEqual(catalogueConflicts(a, b), ["connect.ILS.minutes"]);
}

// ── 5. 400 → inline field ──────────────────────────────────────────────────
{
  const r = pricesFieldErrors([
    "catalogue.sales.ILS.minutes",
    "catalogue.reception.EUR.annual",
    "catalogue.sales.EUR.addonAnnual",
    "catalogue.reception_multi.EUR.addonMonthly",
    "catalogue.nope.EUR.monthly",
    "body",
  ]);
  assert.deepEqual(Object.keys(r.byField).sort(), ["reception.EUR.monthly", "sales.EUR.addonMonthly", "sales.ILS.minutes"]);
  assert.deepEqual(r.other, ["catalogue.reception_multi.EUR.addonMonthly", "catalogue.nope.EUR.monthly", "body"]);
}

// ── 6. Save: re-read, conflict → no PUT; else PUT the patch; 400 → inline ──
type Call = { method: string; body: unknown };
function fakeFetch(server: { cat: ProductCatalogue; putStatus?: number; putFields?: string[] }, calls: Call[]): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, body });
    if (method === "GET") return new Response(JSON.stringify({ catalogue: server.cat, engineOverrides: noEngineOverrides() }), { status: 200 });
    if (server.putStatus === 400) return new Response(JSON.stringify({ error: "invalid_catalogue", fields: server.putFields }), { status: 400 });
    const w = catalogueRowWrite({ catalogue: server.cat, engineOverrides: noEngineOverrides() }, body);
    if (!w.ok) return new Response(JSON.stringify({ error: w.error, fields: w.fields }), { status: 400 });
    server.cat = w.value;
    return new Response(JSON.stringify({ ok: true, catalogue: w.value, engineOverrides: w.engineOverrides }), { status: 200 });
  }) as typeof fetch;
}
{
  const loaded = defaultProductCatalogue();
  const patch = pricesPatch(loaded, { "reception.EUR.monthly": "95", "sales.ILS.overagePerMin": "2.1" });

  // Happy path: GET then PUT with exactly the patch.
  {
    const calls: Call[] = [];
    const server = { cat: defaultProductCatalogue() };
    pending.push(
      savePrices(fakeFetch(server, calls), loaded, patch).then((r) => {
        assert.ok(r.ok);
        assert.deepEqual(calls.map((c) => c.method), ["GET", "PUT"]);
        assert.deepEqual(calls[1]!.body, { catalogue: patch });
        assert.equal(server.cat.reception.EUR.monthly, 95);
        assert.equal(server.cat.sales.ILS.overagePerMin, 2.1);
      }),
    );
  }
  // Conflict: the server changed since load → no PUT at all, latest returned.
  {
    const calls: Call[] = [];
    const server = { cat: defaultProductCatalogue() };
    server.cat.connect.EUR.monthly = 59;
    pending.push(
      savePrices(fakeFetch(server, calls), loaded, patch).then((r) => {
        assert.ok(!r.ok && r.kind === "conflict");
        assert.deepEqual(r.paths, ["connect.EUR.monthly"]);
        assert.equal(r.latest.connect.EUR.monthly, 59);
        assert.deepEqual(calls.map((c) => c.method), ["GET"]);
        assert.equal(server.cat.reception.EUR.monthly, 89, "nothing written");
      }),
    );
  }
  // 400 → the inline field the server names.
  {
    const calls: Call[] = [];
    const server = { cat: defaultProductCatalogue(), putStatus: 400, putFields: ["catalogue.sales.ILS.overagePerMin"] };
    pending.push(
      savePrices(fakeFetch(server, calls), loaded, patch).then((r) => {
        assert.ok(!r.ok && r.kind === "fields");
        assert.deepEqual(Object.keys(r.byField), ["sales.ILS.overagePerMin"]);
      }),
    );
  }
}

// ── 7. The confirmation line tells the truth about live readers ────────────
{
  // The catalogue minutes/overage are read live for accounts with
  // users.products (billing-stats + usage warnings): the line must say so,
  // and must NOT claim existing customers are untouched.
  assert.ok(CONFIRM_LINE.includes("dès l'enregistrement"));
  assert.ok(!/ne sont pas concernés/.test(CONFIRM_LINE));
  const scan = scanSources(["lib"], { ext: /\.ts$/ });
  assert.ok(/getProductCatalogue\(\)/.test(scan.text.get("lib/products-usage.ts") ?? ""), "products-usage reads the catalogue live");
  assert.ok(/accountUsageByProduct/.test(scan.text.get("lib/usage-warnings-deps.ts") ?? ""), "usage warnings read it");
}

// ── 8. Import guard: only the admin reaches these modules ───────────────────
{
  const scan = scanSources(["app", "components", "lib", "i18n", "proxy.ts"], { ext: /\.(ts|tsx|mjs|js)$/ });
  assertScanRead(scan, "catalogue-prices-imports", {
    minFiles: 300,
    sentinels: ["app/admin/admin-shell.tsx", "app/[locale]/dashboard/config-form.tsx"],
  });
  const MOD = /(?:from\s+|import\(\s*)["'][^"']*\/(?:catalogue-prices-ui|ProductPricesForm)["']/;
  const importers = scan.files.filter((f) => MOD.test(scan.text.get(f) ?? ""));
  assert.deepEqual(importers.sort(), ["app/admin/admin-shell.tsx", "app/admin/engine-override/ProductPricesForm.tsx"]);
  for (const f of importers) assert.ok(f.startsWith("app/admin/"));
  assert.ok(REPO_ROOT.length > 0);
}

Promise.all(pending).then(
  () => console.log("ALL CATALOGUE PRICES ADMIN UI TESTS PASSED"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
