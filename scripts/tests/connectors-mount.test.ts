// C1b: the connectors list MOUNTED on the live Connect page.
//   1. The mounted page per state, fr/en/he (ConnectPageContent, as both
//      Connect pages render it): owned with the legacy card; owned with 0
//      connectors (the empty card + "Commencer"); real (non-legacy) cards;
//      trial-locked; the admin tenant view (asUserId); the closed preview
//      reads nothing of the connectors.
//   2. The legacy card's actions call the EXISTING routes, and nothing else:
//      switch → PUT /api/dashboard/tools (byte for byte the brick's own save
//      request when only its switch changes), Tester → POST
//      /api/dashboard/tools/client-agent/test (stored address + secret),
//      refresh after an editor save → GET /api/dashboard/connectors;
//      ?asUserId on EVERY request in the admin tenant view. Answers map to
//      the brick's own words.
//   3. Real cards: switch, Tester, Modifier disabled, no "…" menu, ONE plain line.
//   4. "+ Ajouter un agent" before the wizard (C2): its title and price line,
//      disabled (aria-disabled, no button, no hover), "Bientôt : ajoutez vos
//      agents ici."; locked states keep their own words.
//   5. "Modifier" and "Commencer" open today's "Votre agent IA" editor in place.
//   6. The server side: the page reads the GET's own function (no HTTP call
//      to itself), for the viewed tenant in the admin view; the prices.
//   7. Source guards: the mock is test-only; the new files are client-safe.
// Mock data only (lib/connectors/mock.ts, *.example.test); no request is made:
// every fetch is a recording fake.
// Run with:  npx tsx scripts/tests/connectors-mount.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ConnectPageContent } from "../../app/[locale]/dashboard/agent/connect-view";
import { clientAgentSaveRequest, clientAgentStoredTestRequest, clientAgentSwitchRequest, type ScreenTools } from "../../components/bricks/tools/tools-ui";
import { connectorActions, type FetchLike } from "../../components/connectors/connector-actions";
import { cardActionsMode, ConnectorsPanel, EDITOR_HASH, LEGACY_ID, withLegacyEnabled } from "../../components/connectors/ConnectorsPanel";
import { connectorBasePrice, formatConnectorPrice } from "../../lib/connectors/list-view";
import { MOCK_EXTRA_PRICE, MOCK_LEGACY, MOCK_NOW, MOCK_PAGES } from "../../lib/connectors/mock";
import { connectorsMount, type ConnectorsMount } from "../../lib/connectors/mount";
import type { ConnectorsPageView } from "../../lib/connectors/types";
import { PREVIEW_CLIENT_AGENT } from "../../lib/preview-samples";
import { DEFAULT_PRODUCT_CATALOGUE } from "../../lib/product-catalogue";
import { PRODUCT_TRIAL_DAYS, PRODUCT_TRIAL_MINUTES } from "../../lib/product-trials";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (p: string) => read(p).replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
const count = (s: string, needle: string) => s.split(needle).length - 1;
const ROUTER = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const TERMS = { days: PRODUCT_TRIAL_DAYS, minutes: PRODUCT_TRIAL_MINUTES };
const html = (l: string, node: ReactNode) =>
  renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: ROUTER as never },
      createElement(NextIntlClientProvider, { locale: l, messages: messages(l), timeZone: "UTC", now: new Date(MOCK_NOW) } as ProviderProps, node),
    ),
  );
const C = (l: string) => messages(l).ConnectorsList;
const BASE = connectorBasePrice(DEFAULT_PRODUCT_CATALOGUE, "EUR");
const mount = (page: ConnectorsPageView, extraPrice = MOCK_EXTRA_PRICE.EUR): ConnectorsMount => ({ page, extraPrice, basePrice: BASE, now: MOCK_NOW });
const owned = (l: string, connectors: ConnectorsMount | null, asUserId: string | null = null) =>
  html(
    l,
    createElement(ConnectPageContent, {
      view: { kind: "brick" },
      title: messages(l).DashboardNav.connect,
      trialNote: null,
      trialTerms: TERMS,
      connectors,
      asUserId,
    }),
  );
/** The add card's markup (from its data-add-card to the end of the list). */
const addCardOf = (out: string) => out.slice(out.indexOf("data-add-card="), out.indexOf("</ul>"));
/** One card's markup. */
const cardOf = (out: string, id: string) => {
  const at = out.indexOf(`data-connector="${id}"`);
  return out.slice(at, out.indexOf("</article>", at));
};

// ── 1. The mounted page per state ───────────────────────────────────────────
for (const l of LOCALES) {
  const c = C(l);
  const title = messages(l).DashboardNav.connect;

  // Owned, with the derived legacy card (paid: the add card is open for the BE).
  const legacy = owned(l, mount(MOCK_PAGES.derivedPaid));
  assert.ok(legacy.includes(`>${esc(title)}</h1>`), `${l} legacy: the renamed title`);
  assert.ok(legacy.includes("data-connectors-panel") && legacy.includes('data-connector="legacy"'), `${l} legacy: the list with the derived card`);
  assert.ok(legacy.includes(esc(c.mainNumber)) && legacy.includes(esc(c.defaultName)), `${l} legacy: "Répond sur votre numéro principal", the default name`);
  const card = cardOf(legacy, "legacy");
  assert.ok(card.includes('data-actions="live"'), `${l} legacy: live actions`);
  assert.match(card, /<button type="button" role="switch" aria-checked="true" aria-label="[^"]+" class=/, `${l} legacy: the switch, on and enabled`);
  assert.ok(!/role="switch"[^>]*disabled=""/.test(card), `${l} legacy: switch not disabled`);
  for (const k of ["data-test-action", "data-edit-action"]) {
    const btn = card.match(new RegExp(`<button[^>]*${k}[^>]*>`))?.[0] ?? "";
    assert.ok(btn && !/\sdisabled=""/.test(btn), `${l} legacy: ${k} enabled`);
  }
  assert.ok(!card.includes("data-actions-soon") && !card.includes("data-card-menu"), `${l} legacy: no soon line, no "…" (never deletable)`);
  // No editor until "Modifier" / "Commencer" (nor the brick's loading line).
  assert.ok(!legacy.includes("data-connector-editor") && !legacy.includes(esc(messages(l).ToolsBrick.loading)), `${l} legacy: editor closed`);

  // Owned, 0 connectors: the empty card, its "Commencer" is a live button.
  const empty = owned(l, mount(MOCK_PAGES.emptyPaid, null as never));
  assert.ok(empty.includes("data-connectors-empty") && empty.includes(esc(c.empty.title)), `${l} empty: "Branchez votre premier agent"`);
  assert.match(empty, new RegExp(`<button type="button" class="[^"]*" data-empty-cta="true">${esc(c.empty.cta)}</button>`), `${l} empty: "Commencer"`);
  assert.ok(!empty.includes("data-connectors-list"), `${l} empty: no list`);

  // Not read (the account vanished between the two reads): today's brick alone, never an empty page.
  const none = owned(l, null);
  assert.ok(none.includes(esc(messages(l).ToolsBrick.loading)) && !none.includes("data-connectors-panel"), `${l} none: the brick`);

  // The admin tenant view: the same list, rendered for the tenant.
  const admin = owned(l, mount(MOCK_PAGES.derivedPaid), "u-tenant-1");
  assert.ok(admin.includes('data-connector="legacy"'), `${l} admin tenant view: the tenant's legacy card`);

  // The closed preview reads nothing of the connectors (byte-for-byte the same).
  const preview = { kind: "preview", cta: "soon", notify: true, adminNote: false } as const;
  const props = { view: preview, title, trialNote: null, trialTerms: TERMS };
  assert.equal(
    html(l, createElement(ConnectPageContent, { ...props, connectors: mount(MOCK_PAGES.derivedPaid) })),
    html(l, createElement(ConnectPageContent, props)),
    `${l}: the closed preview ignores the connectors`,
  );
}
console.log("ok: the mounted page per state");

// ── 2. The legacy card's actions: the existing routes, asUserId on every request ─
type Call = { url: string; method: string; body: string | undefined };
function recorder(answers: Array<{ status: number; body: unknown } | "throw">): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      const a = answers[Math.min(i++, answers.length - 1)];
      if (a === "throw") throw new Error("network");
      return new Response(JSON.stringify(a.body), { status: a.status, headers: { "Content-Type": "application/json" } });
    },
  };
}
const TOOLS_OK = { status: 200, body: PREVIEW_CLIENT_AGENT };
const run = async () => {
  for (const asUserId of [null, "u-tenant-1"] as const) {
    const qs = asUserId ? `?asUserId=${asUserId}` : "";
    const r = recorder([TOOLS_OK, { status: 200, body: { ok: true, ms: 412.4 } }, { status: 200, body: MOCK_PAGES.derivedPaid }]);
    const a = connectorActions(r.fetch, asUserId);
    assert.deepEqual(await a.toggle(false), { ok: true, generated: null });
    assert.deepEqual(await a.test(), { key: "ok", ms: 412 });
    assert.deepEqual(await a.refresh(), JSON.parse(JSON.stringify(MOCK_PAGES.derivedPaid)));
    assert.deepEqual(
      r.calls,
      [
        { url: `/api/dashboard/tools${qs}`, method: "PUT", body: '{"tools":{"clientAgent":{"enabled":false}}}' },
        { url: `/api/dashboard/tools/client-agent/test${qs}`, method: "POST", body: "{}" },
        { url: `/api/dashboard/connectors${qs}`, method: "GET", body: undefined },
      ],
      `asUserId=${asUserId}: the three existing routes, in order`,
    );
    if (asUserId) assert.ok(r.calls.every((c) => c.url.endsWith(`?asUserId=${asUserId}`)), "admin view: asUserId on EVERY request");

    // The switch IS the brick's save request when only its switch changed (byte for byte).
    const base = PREVIEW_CLIENT_AGENT.tools as ScreenTools;
    for (const enabled of [false, true]) {
      const from = { ...base, clientAgent: { ...base.clientAgent, enabled: !enabled } };
      const to = { ...from, clientAgent: { ...from.clientAgent, enabled } };
      assert.deepEqual(clientAgentSwitchRequest(enabled, asUserId), clientAgentSaveRequest(from, to, asUserId), `switch ${enabled}: the brick's request`);
    }
    assert.deepEqual(clientAgentStoredTestRequest(asUserId), { url: `/api/dashboard/tools/client-agent/test${qs}`, body: "{}" });
  }

  // Answers → the brick's words (never the server's message).
  const refusals: Array<[{ status: number; body: unknown } | "throw", unknown]> = [
    [{ status: 403, body: { error: "client_agent_disabled", fields: ["clientAgent.enabled"] } }, { ok: false, refused: "disabled" }],
    [{ status: 400, body: { error: "unsafe_url", message: "x", fields: ["clientAgent.url"] } }, { ok: false, refused: "unsafeUrl" }],
    [{ status: 500, body: null }, { ok: false, refused: null }],
    [{ status: 200, body: { nope: true } }, { ok: false, refused: null }],
    ["throw", { ok: false, refused: null }],
  ];
  for (const [answer, expected] of refusals) assert.deepEqual(await connectorActions(recorder([answer]).fetch).toggle(true), expected);
  // Switched on without a secret: the server's one-time secret (#437) comes back, read as the brick reads it.
  const SECRET = "mock-secret-" + "x".repeat(24);
  assert.deepEqual(
    await connectorActions(recorder([{ status: 200, body: { ...PREVIEW_CLIENT_AGENT, generatedSecret: SECRET } }]).fetch).toggle(true),
    { ok: true, generated: SECRET },
  );
  for (const junk of ["short", 42, null, "has space in it but long enough"])
    assert.deepEqual(
      await connectorActions(recorder([{ status: 200, body: { ...PREVIEW_CLIENT_AGENT, generatedSecret: junk } }]).fetch).toggle(true),
      { ok: true, generated: null },
      `implausible generatedSecret ${JSON.stringify(junk)} ignored`,
    );
  const tests: Array<[{ status: number; body: unknown } | "throw", unknown]> = [
    [{ status: 429, body: { error: "rate_limited" } }, { key: "rateLimited" }],
    [{ status: 403, body: { error: "client_agent_disabled" } }, { key: "disabled" }],
    [{ status: 200, body: { ok: false, reason: "timeout" } }, { key: "timeout" }],
    ["throw", { key: "generic" }],
  ];
  for (const [answer, expected] of tests) assert.deepEqual(await connectorActions(recorder([answer]).fetch).test(), expected);
  assert.equal(await connectorActions(recorder([{ status: 403, body: {} }]).fetch).refresh(), null, "refresh refused → keep the page");

  // The routes exist (and nothing else is called): GET connectors, PUT tools, POST test.
  assert.match(read("app/api/dashboard/connectors/route.ts"), /export async function GET\(/);
  assert.match(read("app/api/dashboard/tools/route.ts"), /export async function PUT\(/);
  assert.match(read("app/api/dashboard/tools/client-agent/test/route.ts"), /export async function POST\(/);
  for (const f of ["components/connectors/ConnectorsPanel.tsx", "components/connectors/connector-actions.ts"]) {
    const urls = [...code(f).matchAll(/["'`](\/api\/[^"'`?$]+)/g)].map((m) => m[1]);
    for (const u of urls) assert.ok(["/api/dashboard/connectors"].includes(u), `${f}: only existing routes (${u})`);
  }
  assert.doesNotMatch(code("components/connectors/ConnectorsPanel.tsx"), /\bfetch\(\s*["'`]/, "the panel builds no request of its own");
};

// ── 3. Real (non-legacy) cards: disabled, one plain line ────────────────────
function checkRealCards() {
  for (const l of LOCALES) {
    const c = C(l);
    const out = owned(l, mount(MOCK_PAGES.threePaid));
    const ids = [...out.matchAll(/data-connector="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, 3);
    for (const id of ids) {
      const card = cardOf(out, id);
      assert.ok(card.includes('data-actions="soon"'), `${l} ${id}: soon`);
      assert.match(card, /role="switch"[^>]*disabled=""/, `${l} ${id}: the switch disabled`);
      for (const k of ["data-test-action", "data-edit-action"]) {
        const btn = card.match(new RegExp(`<button[^>]*${k}[^>]*>`))?.[0] ?? "";
        assert.ok(/\sdisabled=""/.test(btn) && /aria-describedby="connector-[^"]+-soon"/.test(btn), `${l} ${id}: ${k} disabled, described by the line`);
      }
      assert.equal(count(card, `>${esc(c.actionsSoon)}</p>`), 1, `${l} ${id}: ONE plain line`);
      assert.ok(!card.includes("data-card-menu"), `${l} ${id}: no "…" menu (no delete route)`);
    }
    assert.equal(cardActionsMode({ id: LEGACY_ID, derived: true }), "live");
    assert.equal(cardActionsMode({ id: LEGACY_ID, derived: false }), "soon", "a row that happens to be called legacy is not the derived card");
    assert.equal(cardActionsMode({ id: "00000000-0000-4000-8000-000000000001", derived: true }), "soon");
  }
  assert.equal(C("fr").actionsSoon, "Bientôt : les réglages de cet agent arrivent ici.");
  assert.equal(C("en").actionsSoon, "Coming soon: this agent's settings will be here.");
  assert.equal(C("he").actionsSoon, "בקרוב: ההגדרות של הסוכן הזה יופיעו כאן.");
  console.log("ok: real cards disabled with one line");
}

// ── 4. The add card before the wizard ───────────────────────────────────────
function checkAddCard() {
  for (const l of LOCALES) {
    const c = C(l);
    const add = addCardOf(owned(l, mount(MOCK_PAGES.derivedPaid)));
    assert.ok(add.startsWith('data-add-card="add"') && add.includes("data-add-soon"), `${l}: the open add card, pre-C2`);
    assert.ok(add.includes(esc(c.add.title)), `${l}: its title kept`);
    const priceLine = c.add.price.replace("{price}", formatConnectorPrice(MOCK_EXTRA_PRICE.EUR, l));
    assert.ok(add.includes(`data-add-price="true">${esc(priceLine)}</span>`), `${l}: its price line kept (${priceLine})`);
    assert.ok(add.includes(`>${esc(c.add.soonLine)}</span>`), `${l}: "Bientôt : ajoutez vos agents ici."`);
    const wrap = owned(l, mount(MOCK_PAGES.derivedPaid)).match(/<div aria-disabled="true" class="([^"]*)" data-add-card="add"/);
    assert.ok(wrap, `${l}: aria-disabled`);
    assert.ok(!/hover:/.test(wrap![1]) && /cursor-not-allowed/.test(wrap![1]), `${l}: no hover affordance`);
    assert.ok(!/<button/.test(add), `${l}: nothing to click`);
    // Locked: the canAdd words, unchanged.
    const trial = addCardOf(owned(l, mount(MOCK_PAGES.derivedTrial)));
    assert.ok(trial.startsWith('data-add-card="trial"') && trial.includes('data-add-lock="trial"') && !trial.includes("data-add-soon"), `${l}: trial-locked, its own words`);
    const closed = addCardOf(owned(l, mount(MOCK_PAGES.derivedPaidOrdersOff)));
    assert.ok(closed.startsWith('data-add-card="soon"'), `${l}: orders closed → "Bientôt" pill`);
  }
  assert.equal(C("fr").add.soonLine, "Bientôt : ajoutez vos agents ici.");
  assert.equal(C("en").add.soonLine, "Coming soon: add your agents here.");
  assert.equal(C("he").add.soonLine, "בקרוב: הוסיפו כאן את הסוכנים שלכם.");
  console.log("ok: the add card disabled before C2");
}

// ── 5. Modifier / Commencer open today's editor ─────────────────────────────
function checkEditor() {
  for (const l of LOCALES) {
    for (const [page, who] of [
      [MOCK_PAGES.derivedPaid, "legacy"],
      [MOCK_PAGES.emptyPaid, "empty"],
    ] as const) {
      const open = html(
        l,
        createElement(ConnectorsPanel, { page, extraPrice: null, basePrice: BASE, now: MOCK_NOW, asUserId: "u-tenant-1", initialEditorOpen: true }),
      );
      assert.ok(open.includes("data-connector-editor"), `${l} ${who}: the editor in place`);
      assert.ok(open.includes(`aria-busy="true">${esc(messages(l).ToolsBrick.loading)}</p>`), `${l} ${who}: the "Votre agent IA" brick (loading its GET)`);
      assert.ok(open.indexOf("data-connector-editor") > open.indexOf(who === "legacy" ? "data-connectors-list" : "data-connectors-empty"), `${l} ${who}: under the list`);
      assert.ok(open.includes(`>${esc(C(l).closeEditor)}</button>`), `${l} ${who}: a close button`);
    }
  }
  const src = code("components/connectors/ConnectorsPanel.tsx");
  assert.match(src, /onEdit=\{\(id\) => \{\s*if \(id === LEGACY_ID\) openEditor\(\);\s*\}\}/, "Modifier (legacy) opens the editor");
  assert.match(src, /onAdd=\{openEditor\}/, "Commencer (empty card) opens the editor");
  assert.match(read("components/connectors/ConnectorsList.tsx"), /onClick=\{onAdd\} data-empty-cta/, "the empty card's button calls onAdd");
  assert.match(
    src,
    /<ClientAgentBrick key=\{editorKey\} asUserId=\{asUserId\} onSaved=\{onSaved\} initialGenerated=\{handoff\} \/>/,
    "the brick, scoped to the tenant, re-reads the list once saved, and shows a secret the switch got back",
  );
  assert.match(src, /setHandoff\(r\.generated\);\s*setEditorKey\(\(k\) => k \+ 1\);\s*if \(r\.generated\) openEditor\(\);/, "a generated secret opens the editor");
  assert.match(src, /setEditorOpen\(false\);\s*setHandoff\(null\);/, "closing the editor forgets it");
  assert.match(read("components/bricks/client-agent/ClientAgentBrick.tsx"), /useState<string \| null>\(initialGenerated\)/, "the brick's own one-time box shows it");
  assert.match(src, /setEditorKey\(\(k\) => k \+ 1\)/, "after the card's switch, the editor reloads the setting");
  assert.equal(EDITOR_HASH, "#client-agent");
  assert.match(read("components/bricks/client-agent/ClientAgentBrick.tsx"), /setDirty\(false\);\s*onSaved\?\.\(\);/, "the brick calls onSaved after a successful save only");
  // The switch's local state after a save.
  const off = withLegacyEnabled(MOCK_PAGES.derivedPaid, false);
  assert.deepEqual(off.connectors[0], { ...MOCK_PAGES.derivedPaid.connectors[0], enabled: false, state: "off" });
  assert.deepEqual(withLegacyEnabled(off, true).connectors[0], { ...MOCK_PAGES.derivedPaid.connectors[0], enabled: true, state: "online" });
  assert.deepEqual(withLegacyEnabled(MOCK_PAGES.threePaid, false), MOCK_PAGES.threePaid, "real cards untouched");
  console.log("ok: Modifier / Commencer open the editor");
}

// ── 6. Server side ──────────────────────────────────────────────────────────
function checkServer() {
  const m = code("lib/connectors/mount.ts");
  assert.match(m, /import \{ loadConnectorsPage \} from "\.\/page";/, "the GET's own reader");
  assert.doesNotMatch(m, /fetch\(|\/api\//, "no HTTP call to itself");
  assert.match(read("app/api/dashboard/connectors/route.ts"), /loadConnectorsPage\(r\.userId\)/, "the same function behind the GET");
  // Prices: extraPrice = canAdd.price; basePrice = the catalogue's connect row in the account's currency.
  for (const cur of ["EUR", "ILS"] as const) {
    const page = { ...MOCK_PAGES.derivedPaid, canAdd: { ok: true, price: { monthly: 19, currency: cur } } } as ConnectorsPageView;
    const got = connectorsMount(page, DEFAULT_PRODUCT_CATALOGUE, cur, new Date(MOCK_NOW));
    assert.deepEqual(got, {
      page,
      extraPrice: { monthly: 19, currency: cur },
      basePrice: { monthly: DEFAULT_PRODUCT_CATALOGUE.connect[cur].monthly, currency: cur, minutes: DEFAULT_PRODUCT_CATALOGUE.connect[cur].minutes },
      now: MOCK_NOW,
    });
  }
  assert.equal(connectorsMount({ ...MOCK_PAGES.emptyTrial, canAdd: { ok: true, price: null } }, DEFAULT_PRODUCT_CATALOGUE, "EUR").extraPrice, null);
  assert.equal(connectorsMount(MOCK_PAGES.emptyTrial, DEFAULT_PRODUCT_CATALOGUE, "EUR").extraPrice, null, "no price → none");
  // The pages: only where the list shows, for the viewed account.
  assert.match(code("app/[locale]/dashboard/agent/page.tsx"), /view\.kind === "brick" \? await loadConnectorsMount\(session\.user\.id\) : null/);
  assert.match(code("app/admin/users/[userId]/agent/page.tsx"), /view\.kind === "brick" \? await loadConnectorsMount\(userId\) : null/);
  console.log("ok: server side");
}

// ── 7. Source guards ────────────────────────────────────────────────────────
function checkGuards() {
  const IMPORTS_MOCK = /connectors\/mock["']/;
  for (const f of [
    "components/connectors/ConnectorsPanel.tsx",
    "components/connectors/connector-actions.ts",
    "lib/connectors/mount.ts",
    "app/[locale]/dashboard/agent/page.tsx",
    "app/[locale]/dashboard/agent/connect-owned.tsx",
    "app/admin/users/[userId]/agent/page.tsx",
  ]) {
    assert.ok(existsSync(join(ROOT, f)), f);
    assert.doesNotMatch(read(f), IMPORTS_MOCK, `${f}: never the mock`);
  }
  for (const f of ["components/connectors/ConnectorsPanel.tsx", "components/connectors/connector-actions.ts"]) {
    assert.doesNotMatch(read(f), /lib\/db|next\/headers|server-only|connectors\/mount"|connectors\/page"/, `${f}: client-safe`);
    assert.doesNotMatch(read(f), /localStorage|sessionStorage|console\./, `${f}: nothing stored or logged`);
  }
  // connect-owned (a server component) imports the mount's TYPE only.
  assert.match(read("app/[locale]/dashboard/agent/connect-owned.tsx"), /import type \{ ConnectorsMount \} from "@\/lib\/connectors\/mount";/);
  assert.match(read("app/[locale]/dashboard/agent/connect-view.tsx"), /import type \{ ConnectorsMount \} from "@\/lib\/connectors\/mount";/);
  // The legacy mock card is what the BE derives (sanity of the fixture used above).
  assert.equal(MOCK_LEGACY.id, LEGACY_ID);
  assert.equal(MOCK_LEGACY.derived, true);
  console.log("ok: source guards");
}

run()
  .then(() => {
    console.log("ok: the legacy card's actions call the existing routes");
    checkRealCards();
    checkAddCard();
    checkEditor();
    checkServer();
    checkGuards();
    console.log("connectors-mount: OK");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
