// Product previews (F2): a product the account does not own shows its REAL
// screen read-only over sample data, under its header with ONE button.
//   1. The sample module is fictional (first-customer names, tenant words,
//      supplier words; numbers +97250000000x, *@example.test, *.example.test).
//   2. Preview mode makes NO request: global fetch / XHR / WebSocket /
//      EventSource / sendBeacon stubbed and counted while (a) every read the
//      campaigns screen makes goes through the sample source and every write
//      is refused, (b) the three previews render; (c) every client file a
//      preview reaches is walked: no bare fetch outside the guarded ones, no
//      live-test panel, no session code.
//   3. Read-only and announced: the "Aperçu" region, disabled controls.
//   4. The client-agent brick saves the SAME bytes as the old Tools-brick row.
//   5. Gates unchanged.
// Mock data only — no network, no DB.
// Run with:  npx tsx scripts/tests/product-previews.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FIRST_CUSTOMER_NAME_RULES } from "../first-customer-names.mjs";
import { SUPPLIERS } from "../tenant-bundle-match.mjs";
import { wordHits, wordRules } from "../tenant-words-match.mjs";
import { clientNamespaces } from "./client-namespaces";

import { CampaignList } from "../../app/[locale]/dashboard/campaigns/campaign-list";
import { GRID_TWO, TILE_ROW_SIZE_TWO } from "../../app/[locale]/dashboard/config/sections";
import { ClientAgentRow } from "../../components/bricks/client-agent/ClientAgentBrick";
import { clientAgentSaveRequest, toolsSaveBody, type ScreenTools } from "../../components/bricks/tools/tools-ui";
import { NotifyMeView } from "../../components/dashboard/ProductPreviewHeader";
import { ConnectPreview } from "../../components/preview/ConnectPreview";
import { PreviewProvider } from "../../components/preview/preview-context";
import { ReceptionPreview } from "../../components/preview/ReceptionPreview";
import { SalesPreview } from "../../components/preview/SalesPreview";
import { previewAnswer, previewFetcher } from "../../lib/preview-fetch";
import * as samples from "../../lib/preview-samples";
import { clientAgentEnabled, clientAgentMode } from "../../lib/tools/client-agent-switch";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
const Intl = NextIntlClientProvider as unknown as ComponentType<{ locale: string; messages: unknown; timeZone?: string; children?: ReactNode }>;
const html = (locale: string, el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(Intl, { locale, messages: messages(locale), timeZone: "UTC" }, el));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── The network, stubbed: every way out of the page is counted ──────────────
const calls: string[] = [];
const g = globalThis as unknown as Record<string, unknown>;
g.fetch = (input: unknown) => {
  calls.push(`fetch ${String(input)}`);
  return Promise.reject(new Error("network is stubbed"));
};
for (const name of ["XMLHttpRequest", "WebSocket", "EventSource"])
  g[name] = class {
    constructor() {
      calls.push(name);
      throw new Error(`${name} is stubbed`);
    }
  };
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { sendBeacon: () => (calls.push("sendBeacon"), false), mediaDevices: { getUserMedia: () => (calls.push("getUserMedia"), Promise.reject()) } },
});

async function main() {
// ── 1. The sample module is fictional ───────────────────────────────────────
{
  const all: string[] = [];
  const perLocale: Record<string, string[]> = {};
  let into = all;
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      into.push(v);
      if (into !== all) all.push(v);
    }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const l of LOCALES) {
    into = perLocale[l] = [];
    walk(samples.previewCampaigns(l));
    walk(samples.previewOutboundAgents(l));
    for (const c of samples.previewCampaigns(l)) {
      walk(samples.previewCampaignContacts(l, c.id));
      walk(samples.previewCampaignResults(l, c.id));
    }
    walk(samples.previewLiveTranscript(l));
    walk(samples.PREVIEW_PLAN_LABEL[l]);
    walk([samples.previewNumber(l), ...samples.previewContactNumbers(l)]);
    walk((previewAnswer(l, "/api/dashboard/channels").body as { numbers: Array<{ phoneNumber: string }> }).numbers.map((n) => n.phoneNumber));
  }
  into = all;
  walk(samples.PREVIEW_CLIENT_AGENT);
  walk([samples.PREVIEW_AGENT_URL, samples.PREVIEW_EMAIL]);
  const text = all.join("\n");
  assert.ok(all.length > 100, "the walk reached the samples");
  for (const [label, re] of FIRST_CUSTOMER_NAME_RULES as Array<[string, RegExp]>) assert.doesNotMatch(text, re, `no first-customer name (${label})`);
  for (const l of LOCALES) assert.equal(wordHits(text, l, wordRules(l)).size, 0, `${l}: no internal word`);
  for (const s of SUPPLIERS as string[]) assert.ok(!text.toLowerCase().includes(s), `no supplier word: ${s}`);
  // Numbers follow the page's language, each from a range reserved for fiction (pinned here,
  // not imported, so the module can't loosen its own rule):
  //   fr +33 1 99 00 00 0x, en +1 202-555-01xx, he +972 50-000-000x. Nothing else.
  const FICTION: Record<string, RegExp> = { fr: /^\+3319900000\d$/, en: /^\+120255501\d\d$/, he: /^\+97250000000\d$/ };
  for (const l of LOCALES) {
    const phones = perLocale[l].join("\n").match(/\+\d{6,}/g) ?? [];
    assert.ok(phones.length >= 10, `${l}: numbers reached`);
    for (const p of phones) assert.match(p, FICTION[l], `${l}: ${p} is ${l}'s fictional shape`);
    assert.deepEqual(String(samples.PREVIEW_NUMBER_PATTERNS[l]), String(FICTION[l]), `${l}: the module's own pattern`);
  }
  // And in the module's source: every digit run long enough to be a number is one of the three shapes.
  for (const f of ["lib/preview-samples.ts", "lib/preview-fetch.ts", "components/preview/ReceptionPreview.tsx", "components/preview/LiveTestPreview.tsx", "components/preview/ConnectPreview.tsx", "components/preview/SalesPreview.tsx"]) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\/(?:\\.|[^/\n])+\/[gimsuy]*/g, "");
    for (const m of code.match(/\+?\d[\d\s-]{6,}\d/g) ?? []) {
      const n = m.replace(/[\s-]/g, "");
      if (n.length < 9) continue;
      assert.ok(Object.values(FICTION).some((re) => re.test(n)), `${f}: "${m}" is not a fictional number shape`);
    }
  }
  for (const e of text.match(/[\w.+-]+@[\w.-]+/g) ?? []) assert.match(e, /@example\.test$/, `fictional e-mail ${e}`);
  for (const u of text.match(/https?:\/\/[^\s"]+/g) ?? []) assert.match(new URL(u).hostname, /(^|\.)example\.test$/, `fictional address ${u}`);
  // Two or three campaigns, with contacts and results.
  const cs = samples.previewCampaigns("fr");
  assert.ok(cs.length >= 2 && cs.length <= 3);
  assert.ok(cs.every((c) => samples.previewCampaignContacts("fr", c.id).length > 0));
  assert.ok(cs.filter((c) => samples.previewCampaignResults("fr", c.id).calls.length > 0).length >= 2, "results to look at");
  // The module itself is pure: no I/O, no env.
  const src = read("lib/preview-samples.ts") + read("lib/preview-fetch.ts");
  assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ""), /process\.env|from "@\/lib\/db|(?<![A-Za-z_.])fetch\(|localStorage/);
}

// ── 2a. The sample source: every read answered in memory, every write refused ──
{
  const ids = samples.previewCampaigns("fr").map((c) => c.id);
  const reads = [
    "/api/dashboard/campaigns",
    "/api/dashboard/channels",
    "/api/dashboard/outbound-agents",
    `/api/dashboard/outbound-agents/${samples.previewOutboundAgents("fr")[0].id}`,
    `/api/dashboard/tools?agentId=${samples.previewOutboundAgents("fr")[0].id}`,
    ...ids.map((id) => `/api/dashboard/campaigns/${id}`),
    ...ids.map((id) => `/api/dashboard/campaigns/${id}/results`),
  ];
  for (const l of LOCALES) {
    const f = previewFetcher(l);
    for (const url of reads) {
      const res = await f(url);
      assert.equal(res.status, 200, `${l} ${url}`);
      assert.ok(await res.json());
    }
    const one = (await (await f(`/api/dashboard/campaigns/${ids[0]}`)).json()) as { contacts: unknown[]; counts: { total: number } };
    assert.ok(one.contacts.length > 0 && one.counts.total > 0, "contacts and counts");
    // The live console (admin-only) gets what a tenant gets: refused, so it renders nothing.
    assert.equal((await f(`/api/dashboard/campaigns/${ids[0]}/live`)).status, 403);
    for (const [url, method] of [
      ["/api/dashboard/campaigns", "POST"],
      [`/api/dashboard/campaigns/${ids[0]}`, "PATCH"],
      [`/api/dashboard/campaigns/${ids[0]}`, "DELETE"],
      [`/api/dashboard/campaigns/${ids[0]}/status`, "POST"],
      [`/api/dashboard/campaigns/${ids[0]}/test-call`, "POST"],
      [`/api/dashboard/campaigns/${ids[0]}/contacts`, "POST"],
      ["/api/dashboard/tools", "PUT"],
    ]) {
      const res = await f(url, { method });
      assert.equal(res.status, 403, `${method} ${url} refused`);
    }
  }
  assert.deepEqual(previewAnswer("fr", "/api/anything/else"), { status: 403, body: { error: "preview" } });
  assert.deepEqual(calls, [], "the sample source never touched the network");
}

// ── 2b + 3. The previews render with no request; read-only and announced ──
{
  for (const l of LOCALES) {
    const m = messages(l);
    const badge = esc(m.DashboardNav.previewBadge);
    const note = esc(m.DashboardNav.previewNote);

    const reception = html(l, createElement(ReceptionPreview));
    assert.ok(reception.includes(badge) && reception.includes(note), `${l}: reception says "preview"`);
    assert.match(reception, /<section aria-labelledby="[^"]+-label" aria-describedby="[^"]+-note" data-preview-frame=""/, `${l}: a named, described region`);
    const shown = { fr: "+33 1 99 00 00 01", en: "+1 202-555-0101", he: "+972 50-000-0001" }[l];
    assert.ok(reception.includes(shown), `${l}: the sample number in the page's language (${shown})`);
    for (const other of ["+33 1 99", "+1 202", "+972 50"].filter((x) => !shown.startsWith(x))) assert.ok(!reception.includes(other), `${l}: no ${other}`);
    assert.ok(reception.includes(">14<") && reception.includes(">27<"), `${l}: the sample figures`);
    assert.match(reception, /data-live-test-preview=""/, `${l}: the static live test`);
    assert.match(reception, /<button type="button" disabled=""[^>]*aria-label="[^"]+"/, `${l}: the mic button is disabled`);
    // No sample channels / notifications tiles: an account sees its REAL ones on Mon agent.
    for (const k of ["wowTileNotifs", "wowTagNotifs", "wowNotifsSummaryActive", "channelsTile", "channelsTileTagline", "channelsTileTaglinePhoneOnly"])
      assert.ok(!reception.includes(esc(m.DashboardConfig[k])), `${l}: no sample tile (${k})`);
    assert.ok(!reception.includes(GRID_TWO) && !reception.includes(TILE_ROW_SIZE_TWO) && !reception.includes("<fieldset"), `${l}: no tile grid`);
    assert.ok(!reception.includes("xl:grid-cols-[minmax(0,1fr)_360px]") && !reception.includes("xl:col-start-2"), `${l}: the live test is not alone in a right column`);
    for (const line of samples.previewLiveTranscript(l)) assert.ok(reception.includes(esc(line.text)), `${l}: sample line`);

    const connect = html(l, createElement(ConnectPreview));
    assert.ok(connect.includes(badge), `${l}: Votre agent says "preview"`);
    assert.match(connect, /<fieldset disabled=""/, `${l}: every control of the brick disabled`);
    assert.ok(connect.includes(`value="${samples.PREVIEW_AGENT_URL}"`), `${l}: the sample address`);
    assert.ok(connect.includes(esc(m.ToolsBrick.agent.test.ok.replace("{ms}", "412"))), `${l}: the sample test result`);
    assert.ok(!connect.includes(esc(m.DashboardConfig.saveButton)), `${l}: no save in a preview`);
    assert.ok(connect.includes(esc(m.ClientAgentBrick.title)));

    const sales = html(l, createElement(SalesPreview));
    assert.ok(sales.includes(badge), `${l}: Ventes says "preview"`);
    // The workspace's list, over the samples, in preview mode: no create, no delete.
    const list = html(
      l,
      createElement(
        PreviewProvider as unknown as ComponentType<{ lang: string; children?: ReactNode }>,
        { lang: l },
        createElement(CampaignList, { campaigns: samples.previewCampaigns(l), loading: false, error: null, onOpen() {}, onCreate() {}, onDelete() {}, onAnalytics() {} }),
      ),
    );
    for (const c of samples.previewCampaigns(l)) assert.ok(list.includes(esc(c.name)), `${l}: ${c.name}`);
    assert.ok(!list.includes(`aria-label="${esc(m.DashboardCampaigns.deleteCampaign)}"`), `${l}: no delete in a preview`);
    assert.match(list, /<button type="button" disabled=""/, `${l}: "new campaign" disabled`);
    assert.ok(list.includes(`aria-label="${esc(m.DashboardCampaigns.analytics)}"`), `${l}: the results stay open`);
    // Owned (no provider): the same list keeps its writes.
    const owned = html(l, createElement(CampaignList, { campaigns: samples.previewCampaigns(l), loading: false, error: null, onOpen() {}, onCreate() {}, onDelete() {}, onAnalytics() {} }));
    assert.ok(owned.includes(`aria-label="${esc(m.DashboardCampaigns.deleteCampaign)}"`) && !/<button type="button" disabled=""/.test(owned), `${l}: owned list unchanged`);
  }
  assert.deepEqual(calls, [], "rendering the previews made no request");
}

// ── 3b. The "Aperçu" bar sits ON the preview card, well below the header ────
// (F3 push) Right under "C'est noté, nous vous préviendrons." the sample-data
// line read as a contradiction: the label and the line are now the card's top
// bar, the screen right under them inside the card, with room above the card.
{
  for (const l of LOCALES) {
    const m = messages(l);
    const badge = esc(m.DashboardNav.previewBadge);
    const note = esc(m.DashboardNav.previewNote);
    for (const [name, C] of [
      ["reception", ReceptionPreview],
      ["connect", ConnectPreview],
      ["sales", SalesPreview],
    ] as const) {
      const out = html(l, createElement(C));
      const frame = out.match(/<section [^>]*data-preview-frame=""[^>]*class="([^"]*)"/);
      assert.ok(frame, `${l} ${name}: the frame`);
      assert.match(frame[1], /\bmt-12\b/, `${l} ${name}: room above the card`);
      const card = new RegExp(
        `data-preview-frame=""[^>]*><div data-preview-card=""[^>]*><div data-preview-bar=""[^>]*><span id="[^"]+-label"[^>]*>[\\s\\S]*?${badge}</span><p id="[^"]+-note"[^>]*>${note}</p></div><div class="p-4 sm:p-6">`,
      );
      assert.match(out, card, `${l} ${name}: label + sample line are the card's top bar, the screen under them inside the card`);
      assert.equal(out.split(note).length - 1, 1, `${l} ${name}: the sample line once`);
    }
    // The header's "notified" line carries no sample-data line (they are apart).
    const done = html(l, createElement(NotifyMeView, { phase: "done" }));
    assert.ok(done.includes(esc(m.DashboardNav.previewNotified)) && !done.includes(note), `${l}: the notified line stands alone`);
  }
}

// ── 2c. Everything a preview reaches: no request path, no session ───────────
{
  // Any use of the GLOBAL fetch in code (a call, or passed / defaulted as a
  // value), comments stripped; not `typeof fetch`, an object key or `.fetch`.
  // (The first rendered run found one this missed as a call-only pattern: the
  // developer-mode store's `f: Fetch = fetch` default, reached from the
  // campaign editor; now fed with the sample source.)
  const BARE_FETCH = /(?<![A-Za-z_.$/-])(?<!typeof )fetch\b(?![\s]*:|["'-])/g;
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
  // The only fetch uses a preview's code contains, each with the guard that keeps it off in preview.
  const GUARDED: Record<string, RegExp[]> = {
    // Defaults only: the one caller (the hook below) always passes the data source.
    "components/bricks/developer-mode-store.ts": [/export function loadDeveloperMode\(asUserId\?: string \| null, f: Fetch = fetch\)/, /enabled: boolean,\s*f: Fetch = fetch,\s*\): Promise<boolean>/],
    "components/bricks/use-developer-mode.ts": [/const dataFetch = useDataFetch\(\);[\s\S]*?void loadDeveloperMode\(asUserId, dataFetch\);[\s\S]*?setDeveloperMode\(asUserId, enabled, dataFetch\)/],
    "components/preview/preview-context.tsx": [/const browserFetch: typeof fetch = \(input, init\) => fetch\(input, init\);/],
    "components/bricks/client-agent/ClientAgentBrick.tsx": [
      /useEffect\(\(\) => \{\s*if \(preview\) return;[\s\S]{0,200}?fetch\(`\/api\/dashboard\/tools\$\{qs\}`/,
      /const save = async \(\) => \{\s*if \(preview \|\| saving\) return;[\s\S]{0,700}?fetch\(req\.url/,
      /const runTest = async \(\) => \{\s*\/\/ A preview never pings an address\.\s*if \(sampleTest\) return;[\s\S]{0,500}?fetch\(`\/api\/dashboard\/tools\/client-agent\/test/,
    ],
  };
  for (const entry of ["components/preview/SalesPreview.tsx", "components/preview/ReceptionPreview.tsx", "components/preview/ConnectPreview.tsx"]) {
    const { clientFiles } = clientNamespaces([entry]);
    assert.ok(clientFiles.size > 10, `${entry}: walked`);
    for (const abs of clientFiles) {
      const f = abs.replace(ROOT, "");
      const src = readFileSync(abs, "utf8");
      const codeOnly = strip(src);
      const n = (codeOnly.match(BARE_FETCH) ?? []).length;
      if (GUARDED[f]) {
        // use-developer-mode has no global fetch at all: its guard is that it passes the sample source.
        assert.equal(n, f.endsWith("use-developer-mode.ts") ? 0 : GUARDED[f].length, `${f}: exactly the guarded fetch uses`);
        for (const re of GUARDED[f]) assert.match(src, re, `${f}: guard`);
      } else assert.equal(n, 0, `${entry} reaches ${f}, which uses fetch outside the sample source`);
      assert.doesNotMatch(codeOnly, /new (WebSocket|EventSource|XMLHttpRequest)\b|sendBeacon|getUserMedia|livekit|LiveTestPanelLK|live-test\//i, `${entry} reaches ${f}: no session or socket code`);
    }
  }
  // The campaigns screen reads through the hook only (the sample source in a preview).
  for (const f of ["campaigns-workspace", "campaign-contacts-list", "campaign-launch", "campaign-live-console", "contacts-import-step", "campaign-analytics"]) {
    const src = read(`app/[locale]/dashboard/campaigns/${f}.tsx`);
    assert.match(src, /const dataFetch = useDataFetch\(\);/, `${f}: the data hook`);
  }
  const ws = read("app/[locale]/dashboard/campaigns/campaigns-workspace.tsx");
  assert.match(ws, /<fieldset disabled=\{preview\}/, "the editor's steps are disabled in a preview");
  assert.match(ws, /disabled=\{saving \|\| preview\}/, "no save in a preview");
  assert.match(ws, /if \(tab === "setup" && draft\.id && !preview\)/, "no auto-save between steps in a preview");
  assert.match(ws, /activeStatus !== "draft" && !preview && \(/, "no live console in a preview");
}

// ── 4. The client-agent brick saves the SAME bytes as the old Tools-brick row ──
{
  const base: ScreenTools = {
    version: 1,
    booking: { enabled: true, defaultDurationMinutes: null, minNoticeMinutes: null },
    contacts: { enabled: true },
    transfer: { enabled: false, when: "always" },
    orders: { enabled: false, ask: "" },
    clientAgent: { enabled: false, url: "https://agent.example.test/ask", mode: "lead", secretSet: true },
  };
  const ca = (patch: Partial<ScreenTools["clientAgent"]>): ScreenTools => ({ ...base, clientAgent: { ...base.clientAgent, ...patch } });
  // [edit, the body bytes main's configuration page sent for it (pinned)]
  const CASES: Array<[string, ScreenTools, string]> = [
    ["switch on", ca({ enabled: true }), '{"tools":{"clientAgent":{"enabled":true}}}'],
    ["new address", ca({ url: "https://other.example.test/a" }), '{"tools":{"clientAgent":{"url":"https://other.example.test/a","enabled":false}}}'],
    ["mode", ca({ mode: "voice" }), '{"tools":{"clientAgent":{"mode":"voice","enabled":false}}}'],
    ["new secret", ca({ enabled: true, secret: "mock-secret-0000000000000000000000000000000" }), '{"tools":{"clientAgent":{"enabled":true,"secret":"mock-secret-0000000000000000000000000000000"}}}'],
    ["remove secret", ca({ secret: null }), '{"tools":{"clientAgent":{"secret":null,"enabled":false}}}'],
  ];
  for (const [name, next, pinned] of CASES) {
    // The old row's save: ConfigForm's `JSON.stringify({ tools: toolsSaveBody(toolsBase, tools) })`.
    const old = JSON.stringify({ tools: toolsSaveBody(base, next) });
    assert.equal(old, pinned, `${name}: the old bytes`);
    for (const [asUserId, url] of [[null, "/api/dashboard/tools"], ["u-1", "/api/dashboard/tools?asUserId=u-1"]] as const) {
      const req = clientAgentSaveRequest(base, next, asUserId);
      assert.deepEqual(req, { url, body: pinned }, `${name} (${asUserId ?? "tenant"}): same URL, same bytes`);
    }
  }
  assert.equal(clientAgentSaveRequest(base, structuredClone(base)), null, "nothing changed → no request");
  // The brick only ever sends clientAgent, even if another key differed on screen.
  assert.equal(clientAgentSaveRequest(base, { ...ca({ enabled: true }), orders: { enabled: true, ask: "" } })?.body, '{"tools":{"clientAgent":{"enabled":true}}}');
  const brick = read("components/bricks/client-agent/ClientAgentBrick.tsx");
  assert.match(brick, /fetch\(req\.url, \{ method: "PUT", headers: \{ "Content-Type": "application\/json" \}, body: req\.body \}\)/, "PUT, JSON, the request's bytes");
  // The row renders as before (one switch, its fields), now outside the Tools brick.
  const s = { ...samples.PREVIEW_CLIENT_AGENT, tools: base };
  const row = html("fr", createElement(ClientAgentRow, { served: s, tools: base, onChange() {}, refused: null }));
  assert.equal((row.match(/role="switch"/g) ?? []).length, 1);
  assert.match(row, /aria-labelledby="tools-clientAgent-label"/);
}

// ── 5. Gates unchanged ──────────────────────────────────────────────────────
{
  // CLIENT_AGENT: the same truth table.
  for (const [v, admin, on] of [["", false, false], ["", true, false], ["admin", false, false], ["admin", true, true], ["all", false, true], ["junk", true, false]] as const)
    assert.equal(clientAgentEnabled(clientAgentMode({ CLIENT_AGENT: v }), admin), on, `CLIENT_AGENT=${v} admin=${admin}`);
  const connect = read("app/[locale]/dashboard/agent/page.tsx");
  assert.match(connect, /\{clientAgentEnabled\(clientAgentMode\(\), isAdmin\) && <ClientAgentBrick \/>\}/, "the page mounts the brick only where CLIENT_AGENT is on");
  assert.match(read("components/bricks/client-agent/ClientAgentBrick.tsx"), /if \(!clientAgentRowVisible\("inbound", served\)\) return null;/, "and the brick follows the server's answer");
  // Previews never touch a server gate: no gate helper is imported by preview code.
  for (const f of ["components/preview/SalesPreview.tsx", "components/preview/ReceptionPreview.tsx", "components/preview/ConnectPreview.tsx", "components/preview/preview-context.tsx", "lib/preview-fetch.ts"])
    assert.doesNotMatch(read(f), /product-gates|plan-gate|product-entitlement|requireAdmin/, f);
}

assert.deepEqual(calls, []);
console.log("ALL PRODUCT PREVIEW TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
