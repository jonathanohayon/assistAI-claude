// J3: the Calls tab (/dashboard/logs) shows the plain Calls view; the
// engineering console (latency chart + raw event timeline) is level-3
// content, rendered only for admins or with developer mode on, and its
// polling lives inside the gated component. The tab is named "Calls";
// "Monitoring" survives only as the console's title.
// Renders the REAL gate to static HTML in fr/en/he. Mock data only.
// Run with:  npx tsx scripts/tests/calls-console-gate.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DeveloperConsoleGate } from "../../app/[locale]/dashboard/logs/developer-console";
import { REPO_ROOT, assertScanRead, scanSources } from "./helpers/source-scan";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
const esc = (s: string) => s.replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const CONSOLE = "app/[locale]/dashboard/logs/developer-console.tsx";
const LOGS_VIEW = "app/[locale]/dashboard/logs/logs-view.tsx";
const LATENCY = "app/[locale]/dashboard/logs/latency-chart.tsx";
const PAGE = "app/[locale]/dashboard/logs/page.tsx";
const ADMIN_PAGE = "app/admin/users/[userId]/logs/page.tsx";

// Any fetch during render would be a console leak: count them.
let fetches = 0;
globalThis.fetch = (async () => {
  fetches++;
  return new Response("{}");
}) as typeof fetch;

const render = (locale: string, isAdmin: boolean, developerMode: boolean) =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps,
      createElement(DeveloperConsoleGate, { isAdmin, developerMode }),
    ),
  );

// 1. The gate, every combination: only admin or developer mode renders it.
for (const l of LOCALES) {
  const m = messages(l).DashboardLogs;
  for (const isAdmin of [false, true]) {
    for (const dev of [false, true]) {
      const html = render(l, isAdmin, dev);
      const label = `${l} admin=${isAdmin} dev=${dev}`;
      if (!isAdmin && !dev) {
        assert.equal(html, "", `${label}: nothing in the DOM`);
        continue;
      }
      assert.match(html, /data-developer-console/, `${label}: console section`);
      assert.ok(html.includes(`>${esc(m.title)}</h2>`), `${label}: console h2 title`);
      assert.ok(html.includes(esc(m.subtitle)), `${label}: subtitle`);
      assert.ok(html.includes(esc(m.sourceFilterLabel)), `${label}: event timeline (LogsView)`);
    }
  }
}
assert.equal(fetches, 0, "rendering never fetches");

// 2. The polling lives inside the gated component only.
{
  const scan = scanSources(["app", "components", "lib"], { ext: /\.(tsx?|mts)$/ });
  assertScanRead(scan, "console scan", { minFiles: 100, sentinels: [CONSOLE, LOGS_VIEW, LATENCY, PAGE, ADMIN_PAGE] });
  const users = (re: RegExp) => scan.files.filter((f) => re.test(scan.text.get(f) ?? "")).sort();
  // The two polled endpoints are fetched only by the console's parts.
  assert.deepEqual(users(/["'`]\/api\/dashboard\/events[?"'`]/), [LOGS_VIEW], "events fetched only by LogsView");
  assert.deepEqual(users(/["'`]\/api\/dashboard\/call-metrics[?"'`]/), [LATENCY], "call-metrics fetched only by LatencyChart");
  // LogsView is mounted only by the gate; LatencyChart only by LogsView.
  assert.deepEqual(users(/from\s+["'][^"']*\/logs-view["']/), [CONSOLE], "only the gate imports LogsView");
  assert.deepEqual(users(/from\s+["'][^"']*\/latency-chart["']/), [LOGS_VIEW], "only LogsView imports LatencyChart");
  assert.match(read(LOGS_VIEW), /setInterval\(\(\) => fetchLogs\(false\), 3000\)/, "events poll (3 s) in LogsView");
  assert.match(read(LATENCY), /setInterval\(fetchData, POLL_INTERVAL_MS\)/, "call-metrics poll in LatencyChart");
  // The gate returns before LogsView is created, and LogsView appears once.
  const gate = read(CONSOLE);
  const ret = gate.indexOf("if (!showLevel3({ isAdmin, developerMode })) return null;");
  assert.ok(ret > 0 && ret < gate.indexOf("<LogsView"), "gate returns null before mounting LogsView");
  assert.equal(gate.split("<LogsView").length - 1, 1, "LogsView mounted once, inside the gate");
  // The flag comes from the shared store: `on` is false while it loads.
  assert.match(gate, /developerMode=\{dev\.on\}/, "developer mode = dev.on (false while loading)");
  assert.match(read("components/bricks/use-developer-mode.ts"), /on: state\.enabled === true/, "loading (null) is off");
  // Both pages render the gated console, never the bare parts.
  for (const p of [PAGE, ADMIN_PAGE]) {
    const src = read(p);
    assert.match(src, /<DeveloperConsole /, `${p}: gated console`);
    assert.doesNotMatch(src, /<LogsView|<LatencyChart/, `${p}: no bare console parts`);
  }
  assert.match(read(PAGE), /<DeveloperConsole isAdmin=\{isAdmin\} \/>/);
  assert.match(read(ADMIN_PAGE), /<DeveloperConsole isAdmin asUserId=\{target\.id\} \/>/);
}

// 3. The tab is "Calls" in every language (route kept), and in the admin view.
{
  const expected = { fr: "Appels", en: "Calls", he: "שיחות" } as const;
  for (const l of LOCALES) {
    assert.equal(messages(l).Dashboard.tabLogs, expected[l], `${l}: nav label`);
    assert.ok(messages(l).DashboardLogs.metaTitle.startsWith(expected[l]), `${l}: page title`);
  }
  assert.match(read("app/[locale]/dashboard/_nav.tsx"), /\{ href: "\/dashboard\/logs", labelKey: "tabLogs" \}/);
  assert.match(read("app/admin/users/[userId]/_nav.tsx"), /\{ hrefSuffix: "\/logs", label: "Appels" \}/);
  assert.match(read(PAGE), /title: t\("metaTitle"\)/, "page metadata uses the Calls title");
}

// 4. "Monitoring" appears only as the console title.
{
  const monitoring = { fr: "Monitoring", en: "Monitoring", he: "ניטור" } as const;
  const strings = (o: unknown, path = ""): [string, string][] =>
    typeof o === "string"
      ? [[path, o]]
      : Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  for (const l of ["fr", "en"] as const) {
    const hits = strings(messages(l)).filter(([, v]) => v.includes("Monitoring")).map(([k]) => k);
    assert.deepEqual(hits, ["DashboardLogs.title"], `${l}: "Monitoring" only as the console title`);
  }
  // Hebrew: the word is used elsewhere on the marketing pages, so check the
  // namespaces of this tab (nav + console + calls view).
  const he = messages("he");
  const heHits = [["Dashboard", he.Dashboard], ["DashboardLogs", he.DashboardLogs], ["Calls", he.Calls]]
    .flatMap(([ns, o]) => strings(o, ns as string))
    .filter(([, v]) => v.includes(monitoring.he) || v.includes("מעקב"))
    .map(([k]) => k);
  assert.deepEqual(heHits, ["DashboardLogs.title"], 'he: "ניטור" only as the console title');
  for (const l of LOCALES) assert.equal(messages(l).DashboardLogs.title, monitoring[l], `${l}: console title`);
  // No hard-coded "Monitoring" in the tab's sources (code, not comments).
  const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const p of [PAGE, ADMIN_PAGE, CONSOLE, LOGS_VIEW, LATENCY, "app/[locale]/dashboard/logs/calls-view.tsx", "app/[locale]/dashboard/_nav.tsx", "app/admin/users/[userId]/_nav.tsx"])
    assert.doesNotMatch(code(p), /Monitoring/, `${p}: no hard-coded "Monitoring"`);
}

// 5. FR/EN/HE keys match (DashboardLogs, Calls, Dashboard), all non-empty.
{
  const keys = (o: unknown): string[] =>
    typeof o === "string" ? [""] : Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keys(v).map((s) => (s ? `${k}.${s}` : k)));
  for (const ns of ["DashboardLogs", "Calls", "Dashboard"]) {
    const fr = keys(messages("fr")[ns]).sort();
    for (const l of ["en", "he"]) assert.deepEqual(keys(messages(l)[ns]).sort(), fr, `${l}: same ${ns} keys as fr`);
  }
  for (const l of LOCALES) {
    const m = messages(l).DashboardLogs;
    for (const k of ["metaTitle", "header", "title", "subtitle"]) assert.ok(typeof m[k] === "string" && m[k].trim() !== "", `${l}.${k}`);
  }
  for (const k of ["header", "title", "subtitle"]) assert.match(messages("he").DashboardLogs[k], /[֐-׿]/, `he.${k}: Hebrew`);
  assert.match(messages("he").Dashboard.tabLogs, /[֐-׿]/);
}

// Design review (tamaraVP): the receptionist's settings tab is named after the agent it configures,
// so it no longer reads like the Calls tab ("Appels entrants" next to "Appels").
{
  const tab = (l: string) => JSON.parse(readFileSync(join(new URL("../../", import.meta.url).pathname, `messages/${l}.json`), "utf8")).Dashboard.tabConfiguration as string;
  assert.equal(tab("fr"), "Réceptionniste");
  assert.equal(tab("en"), "Receptionist");
  assert.equal(tab("he"), "פקידת קבלה");
}

console.log("calls-console-gate: ok");
