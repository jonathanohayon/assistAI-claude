// ADMIN-ONLY "Coût par moteur" table (app/admin/finance/EngineCostTable.tsx):
// render tests on mock byEngine rows (every rateBasis, the "estimation" label
// placement, nulls → "—", the "Non mesuré" / "Inconnu" labels, the sum check
// and its warning), the per-tenant wiring (FinanceDashboard renders the table
// outside the global-only block, and /admin/users/[userId]/finance mounts
// FinanceDashboard with the tenant's userId), and the import guard.
// Run with:  npx tsx scripts/tests/finance-engine-cost-ui.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import EngineCostTable, {
  DASH,
  ESTIMATE_LABEL,
  FLAT_RATE_CAVEAT,
  engineCostSum,
  isMeasured,
  providerLabel,
  sumMatchesTotal,
} from "../../app/admin/finance/EngineCostTable";
import type { EngineCost } from "../../app/admin/finance/types";
import { REPO_ROOT, assertScanRead, scanSources } from "./helpers/source-scan";

const unescape = (h: string) => h.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const render = (rows: EngineCost[], openaiTotal: number) =>
  unescape(renderToStaticMarkup(createElement(EngineCostTable, { rows, openaiTotal })));

/** The HTML of one data-engine-row (up to the next row or the footer). */
function rowOf(h: string, key: string): string {
  const i = h.indexOf(`data-engine-row="${key}"`);
  assert.ok(i >= 0, `row ${key} rendered`);
  const ends = [h.indexOf("data-engine-row=", i + 10), h.indexOf("data-engine-total", i)].filter((x) => x > 0);
  return h.slice(i, ends.length ? Math.min(...ends) : undefined);
}
/** The content of one cell (data-col) of a row's HTML. */
function cell(row: string, col: string): string {
  const m = row.match(new RegExp(`data-col="${col}"[^>]*>(.*?)</td>`));
  assert.ok(m, `cell ${col}`);
  return m[1]!;
}
const text = (h: string) => h.replace(/<[^>]+>/g, "");

// Mock data: one row per rateBasis plus an unknown engine with null fields.
const FLAT: EngineCost = { provider: "openai", model: "gpt-realtime-2", rateBasis: "openai-flat", calls: 12, minutes: 48.5, costUsd: 3.2, costPerMinuteUsd: 0.066 };
const GEMINI: EngineCost = { provider: "gemini", model: "gemini-live-2.5", rateBasis: "worker-reported", calls: 4, minutes: 10, costUsd: 0.8, costPerMinuteUsd: 0.08 };
const XAI: EngineCost = { provider: "xai", model: "grok-voice", rateBasis: "worker-reported", calls: 2, minutes: 3, costUsd: 0.3, costPerMinuteUsd: 0.1 };
const UNMETERED: EngineCost = { provider: "unmetered", model: null, rateBasis: "openai-per-minute-estimate", calls: null, minutes: 6, costUsd: 0.6, costPerMinuteUsd: 0.1 };
const UNKNOWN: EngineCost = { provider: "unknown", model: null, rateBasis: "worker-reported", calls: 1, minutes: 0, costUsd: 0, costPerMinuteUsd: null };
const ALL = [FLAT, GEMINI, UNMETERED, XAI, UNKNOWN];
const TOTAL = 4.9; // 3.2 + 0.8 + 0.3 + 0.6 + 0
const key = (r: EngineCost) => `${r.provider}|${r.model ?? ""}|${r.rateBasis}`;

// ── 1. Every rateBasis renders, with the right "estimation" placement ──────
{
  const h = render(ALL, TOTAL);
  for (const c of ["Moteur", "Appels", "Minutes", "Coût", "Coût/min"]) assert.match(h, new RegExp(`>${c.replace("/", "\\/")}</th>`));
  assert.equal(isMeasured("worker-reported"), true);
  assert.equal(isMeasured("openai-flat"), false);
  assert.equal(isMeasured("openai-per-minute-estimate"), false);

  // Estimates: the label sits next to Coût and Coût/min, never next to counts.
  for (const r of [FLAT, UNMETERED]) {
    const row = rowOf(h, key(r));
    assert.match(cell(row, "cost"), new RegExp(`data-estimate[^>]*>${ESTIMATE_LABEL}<`), `${r.provider} cost estimate`);
    assert.match(cell(row, "per-minute"), new RegExp(`data-estimate[^>]*>${ESTIMATE_LABEL}<`), `${r.provider} per-min estimate`);
    assert.doesNotMatch(cell(row, "calls"), /data-estimate/);
    assert.doesNotMatch(cell(row, "minutes"), /data-estimate/);
    assert.equal((row.match(/data-estimate/g) ?? []).length, 2);
  }
  // Measured rows: no label at all.
  for (const r of [GEMINI, XAI, UNKNOWN]) assert.doesNotMatch(rowOf(h, key(r)), /data-estimate/, `${r.provider} measured`);

  // Formatters: the page's own money/number formats.
  const flat = rowOf(h, key(FLAT));
  assert.equal(text(cell(flat, "cost")), `$3.20${ESTIMATE_LABEL}`);
  assert.equal(text(cell(flat, "per-minute")), `$0.066${ESTIMATE_LABEL}`);
  assert.equal(text(cell(flat, "calls")), "12");
  assert.equal(text(cell(flat, "minutes")), "48.5");
  assert.match(flat, />OpenAI</);
  assert.match(flat, /data-model[^>]*>gpt-realtime-2</);
  assert.match(rowOf(h, key(GEMINI)), />Gemini</);
  assert.match(rowOf(h, key(XAI)), />Grok \(xAI\)</);

  // openai-flat → exactly one caveat line under the table.
  assert.equal((h.match(/data-flat-caveat/g) ?? []).length, 1);
  assert.ok(h.indexOf("data-flat-caveat") > h.indexOf("</table>"), "caveat under the table");
  assert.ok(h.includes(FLAT_RATE_CAVEAT));
}

// No openai-flat row → no caveat.
{
  const h = render([GEMINI, UNMETERED], 1.4);
  assert.doesNotMatch(h, /data-flat-caveat/);
  // The unmetered estimate is still labelled.
  assert.match(rowOf(h, key(UNMETERED)), /data-estimate/);
}

// ── 2. Nulls → "—", never 0; unmetered / unknown labels ────────────────────
{
  const h = render(ALL, TOTAL);
  const un = rowOf(h, key(UNMETERED));
  assert.equal(text(cell(un, "calls")), DASH, "unmetered calls null → —");
  assert.match(un, />Non mesuré</);
  assert.doesNotMatch(un, /data-model/, "no model line for unmetered");
  const uk = rowOf(h, key(UNKNOWN));
  assert.match(uk, />Inconnu</);
  assert.match(uk, new RegExp(`data-model[^>]*>${DASH}<`), "null model → —");
  assert.equal(text(cell(uk, "per-minute")), DASH, "null cost/min → —");
  assert.doesNotMatch(cell(uk, "per-minute"), /\$0/);
  assert.equal(text(cell(uk, "cost")), "$0.00", "a real 0 cost stays 0");
  assert.equal(providerLabel("unmetered"), "Non mesuré");
  assert.equal(providerLabel("unknown"), "Inconnu");
  assert.equal(providerLabel("mistral"), "mistral");
}

// ── 3. Sum = OpenAI total, and the quiet mismatch warning ──────────────────
{
  assert.equal(engineCostSum(ALL), TOTAL);
  assert.equal(sumMatchesTotal(ALL, TOTAL), true);
  const ok = render(ALL, TOTAL);
  assert.doesNotMatch(ok, /data-sum-mismatch/);
  assert.equal(text(cell(ok.slice(ok.indexOf("data-engine-total")), "cost")), `$4.90${ESTIMATE_LABEL}`);
  // Per-row 4-decimal rounding: within a cent still matches.
  const r4 = [{ ...FLAT, costUsd: 1.2345 }, { ...GEMINI, costUsd: 0.0049 }];
  assert.equal(sumMatchesTotal(r4, 1.24), true);
  // A gap → the rows stay, a warning line names both figures.
  const bad = render(ALL, 5.5);
  assert.match(bad, /data-sum-mismatch/);
  assert.match(text(bad), /La somme des moteurs \(\$4\.90\) ne correspond pas au coût OpenAI affiché \(\$5\.50\)\./);
  for (const r of ALL) rowOf(bad, key(r));
  assert.equal(sumMatchesTotal(ALL, 4.92), false);
  // Measured-only rows → the total carries no estimate label.
  const measured = render([GEMINI, XAI], 1.1);
  assert.doesNotMatch(measured, /data-estimate/);
  // Empty → empty state, no table.
  const empty = render([], 0);
  assert.match(empty, /Aucun coût moteur sur cette période\./);
  assert.doesNotMatch(empty, /<table/);
}

// ── 4. Per tenant: same table, tenant-scoped rows and the tenant's total ───
{
  const tenantRows: EngineCost[] = [
    { provider: "gemini", model: "gemini-live-2.5", rateBasis: "worker-reported", calls: 3, minutes: 7.5, costUsd: 0.6, costPerMinuteUsd: 0.08 },
    { provider: "unmetered", model: null, rateBasis: "openai-per-minute-estimate", calls: null, minutes: 2, costUsd: 0.2, costPerMinuteUsd: 0.1 },
  ];
  const h = render(tenantRows, 0.8);
  assert.equal((h.match(/data-engine-row=/g) ?? []).length, 2);
  assert.doesNotMatch(h, /data-sum-mismatch/);
  assert.equal(text(cell(rowOf(h, key(tenantRows[0]!)), "minutes")), "7.5");

  // The dashboard renders the table for both scopes (outside `isGlobal ?`), fed
  // by the response's byEngine and its totals.openai.
  const dash = readFileSync(join(REPO_ROOT, "app/admin/finance/FinanceDashboard.tsx"), "utf8");
  const at = dash.indexOf("<EngineCostTable");
  assert.ok(at > 0, "FinanceDashboard renders EngineCostTable");
  const globalOnly = dash.indexOf("{isGlobal ? (");
  assert.ok(globalOnly > at, "table is before (outside) the global-only block");
  assert.match(dash.slice(at, at + 200), /rows=\{stats\.byEngine \?\? \[\]\}\s*openaiTotal=\{stats\.totals\.openai\}/);
  assert.match(dash, /if \(userId\) params\.set\("userId", userId\)/, "userId scopes the finance-stats fetch");
  // The tenant finance page mounts the dashboard with that tenant's id.
  const page = readFileSync(join(REPO_ROOT, "app/admin/users/[userId]/finance/page.tsx"), "utf8");
  assert.match(page, /<FinanceDashboard userId=\{target\.id\} \/>/);
}

// ── 5. Import guard: no tenant file imports the admin finance modules ──────
{
  const scan = scanSources(["app", "components", "lib", "i18n", "proxy.ts"], { ext: /\.(ts|tsx|mjs|js)$/ });
  assertScanRead(scan, "finance-engine-imports", {
    minFiles: 300,
    sentinels: ["app/admin/finance/FinanceDashboard.tsx", "app/admin/users/[userId]/finance/page.tsx", "app/[locale]/dashboard/config-form.tsx"],
  });
  const MODULE = /(?:from\s+|import\(\s*)["'][^"']*\/(?:EngineCostTable|admin\/finance\/[A-Za-z]+)["']/;
  const importers = scan.files.filter((f) => MODULE.test(scan.text.get(f) ?? ""));
  for (const f of importers) assert.ok(f.startsWith("app/admin/"), `${f} imports an admin finance module`);
  const tableImporters = scan.files.filter((f) => /["'][^"']*\/EngineCostTable["']/.test(scan.text.get(f) ?? ""));
  assert.deepEqual(tableImporters, ["app/admin/finance/FinanceDashboard.tsx"]);
  assert.ok(importers.includes("app/admin/users/[userId]/finance/page.tsx"), "guard sees the @/app/admin/finance import");
}

console.log("ALL FINANCE ENGINE COST UI TESTS PASSED");
