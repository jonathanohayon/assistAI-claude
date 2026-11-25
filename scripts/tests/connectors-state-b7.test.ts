// B7 (FE half): the connector card's new states, before any server sends them.
//   1. The view table: every state (incl. setup_incomplete and an unknown
//      server value) → pill, setup line, unreachable note.
//   2. setup_incomplete renders the AMBER pill "À terminer" + ONE line per
//      setupIssue; any other issue (or none) → the generic line; red stays
//      only for "Agent injoignable". fr/en/he.
//   3. An unknown state (a newer server) → a neutral pill + the generic
//      line, never a crash. fr/en/he.
//   4. The derived legacy card switched OFF: a normal "Éteint" card ("Répond
//      sur votre numéro principal", switch off, live actions), never the
//      empty state.
//   5. Inert: the states the server sends today render no B7 markup.
//   6. Exhaustiveness: every pill has a colour and a word, every line a word,
//      in every locale.
// Mock data only (lib/connectors/mock.ts); no request is made.
// Run with:  npx tsx scripts/tests/connectors-state-b7.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ConnectPageContent } from "../../app/[locale]/dashboard/agent/connect-view";
import { ConnectorsList } from "../../components/connectors/ConnectorsList";
import { connectorActions, type FetchLike } from "../../components/connectors/connector-actions";
import { switchLegacyCard, withLegacyEnabled } from "../../components/connectors/ConnectorsPanel";
import { cardPillOf, connectorBasePrice, connectorsListView, setupLineOf, type CardPill, type SetupLine } from "../../lib/connectors/list-view";
import {
  MOCK_EXTRA_PRICE,
  MOCK_LEGACY,
  MOCK_LEGACY_OFF,
  MOCK_NOW,
  MOCK_OFF,
  MOCK_ONLINE,
  MOCK_PAGES,
  MOCK_SETUP_ROW,
  MOCK_UNREACHABLE,
  mockLegacySetup,
} from "../../lib/connectors/mock";
import type { ConnectorsMount } from "../../lib/connectors/mount";
import type { ConnectorsPageView, ConnectorView } from "../../lib/connectors/types";
import { PREVIEW_CLIENT_AGENT } from "../../lib/preview-samples";
import { DEFAULT_PRODUCT_CATALOGUE } from "../../lib/product-catalogue";
import { PRODUCT_TRIAL_DAYS, PRODUCT_TRIAL_MINUTES } from "../../lib/product-trials";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
type Locale = (typeof LOCALES)[number];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
const ROUTER = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const html = (l: string, node: ReactNode) =>
  renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: ROUTER as never },
      createElement(NextIntlClientProvider, { locale: l, messages: messages(l), timeZone: "UTC", now: new Date(MOCK_NOW) } as ProviderProps, node),
    ),
  );
const C = (l: Locale) => messages(l).ConnectorsList;
const BASE = connectorBasePrice(DEFAULT_PRODUCT_CATALOGUE, "EUR");
const EUR = MOCK_EXTRA_PRICE.EUR;
const pageOf = (connectors: ConnectorView[]): ConnectorsPageView => ({
  connectors,
  limits: { max: 5, used: connectors.length, inTrial: false },
  canAdd: { ok: true },
});
const list = (l: Locale, page: ConnectorsPageView) => html(l, createElement(ConnectorsList, { page, extraPrice: EUR, basePrice: BASE, now: MOCK_NOW }));
const cardOf = (out: string, id: string) => {
  const at = out.indexOf(`data-connector="${id}"`);
  assert.ok(at >= 0, `card ${id} rendered`);
  return out.slice(at, out.indexOf("</article>", at));
};
const pillOf = (card: string) => card.match(/<span class="([^"]*)" data-pill="([^"]+)"><span aria-hidden="true" class="h-2 w-2 rounded-full ([^"]+)"><\/span>([^<]*)<\/span>/);
const mount = (page: ConnectorsPageView): ConnectorsMount => ({ page, extraPrice: EUR, basePrice: BASE, now: MOCK_NOW });
const owned = (l: Locale, page: ConnectorsPageView) =>
  html(
    l,
    createElement(ConnectPageContent, {
      view: { kind: "brick" },
      title: messages(l).DashboardNav.connect,
      trialNote: null,
      trialTerms: { days: PRODUCT_TRIAL_DAYS, minutes: PRODUCT_TRIAL_MINUTES },
      connectors: mount(page),
    }),
  );

// A value this build does not know, as a newer server could send it.
const UNKNOWN_STATE = "paused_by_owner";
const UNKNOWN_ISSUE = "certificate_expired";
const withState = (c: ConnectorView, state: string, setupIssue?: string): ConnectorView =>
  ({ ...c, state, ...(setupIssue === undefined ? {} : { setupIssue }) }) as unknown as ConnectorView;

// The colour classes the app already uses (no new hex): amber = the warning chips, neutral = "off".
const AMBER = { pill: "border-[#fde68a] bg-[#fffbeb] text-[#92400e]", dot: "bg-[#f59e0b]" };
const NEUTRAL = { pill: "border-[#e2e8f0] bg-[#f1f5f9] text-[#475569]", dot: "bg-[#94a3b8]" };
const RED = "#b91c1c";

// ── 1. The view table ───────────────────────────────────────────────────────
type Row = [name: string, c: ConnectorView, pill: CardPill, line: SetupLine | null, unreachable: boolean];
const TABLE: Row[] = [
  ["online", MOCK_ONLINE, "online", null, false],
  ["off", MOCK_OFF, "off", null, false],
  ["unreachable", MOCK_UNREACHABLE, "unreachable", null, true],
  ["setup_incomplete, no_secret", mockLegacySetup("no_secret"), "setup_incomplete", "no_secret", false],
  ["setup_incomplete, secret_unreadable", mockLegacySetup("secret_unreadable"), "setup_incomplete", "secret_unreadable", false],
  ["setup_incomplete, unsafe_url", mockLegacySetup("unsafe_url"), "setup_incomplete", "unsafe_url", false],
  ["setup_incomplete, no issue", mockLegacySetup(), "setup_incomplete", "generic", false],
  ["setup_incomplete, unknown issue", withState(MOCK_LEGACY, "setup_incomplete", UNKNOWN_ISSUE), "setup_incomplete", "generic", false],
  ["setup_incomplete, empty issue", withState(MOCK_LEGACY, "setup_incomplete", ""), "setup_incomplete", "generic", false],
  ["setup_incomplete, a row", MOCK_SETUP_ROW, "setup_incomplete", "unsafe_url", false],
  // An issue on a state that is not setup_incomplete is ignored: no line.
  ["online with a stray issue", withState(MOCK_ONLINE, "online", "no_secret"), "online", null, false],
  ["unreachable with a stray issue", withState(MOCK_UNREACHABLE, "unreachable", "unsafe_url"), "unreachable", null, true],
  ["unknown state", withState(MOCK_ONLINE, UNKNOWN_STATE), "unknown", "generic", false],
  ["unknown state with a known issue", withState(MOCK_ONLINE, UNKNOWN_STATE, "no_secret"), "unknown", "generic", false],
  ["state missing", withState(MOCK_ONLINE, undefined as never), "unknown", "generic", false],
  ['state "toString" (not an own key)', withState(MOCK_ONLINE, "toString"), "unknown", "generic", false],
  ["derived, off", MOCK_LEGACY_OFF, "off", null, false],
  ["derived, on", MOCK_LEGACY, "online", null, false],
];
for (const [name, c, pill, line, unreachable] of TABLE) {
  const v = connectorsListView({ page: pageOf([c]), extraPrice: EUR, basePrice: BASE });
  assert.equal(v.kind, "list", `${name}: a list`);
  if (v.kind !== "list") throw new Error(name);
  const card = v.cards[0];
  assert.deepEqual([card.pill, card.setupLine, card.unreachableNote], [pill, line, unreachable], `${name}: pill, line, note`);
}
assert.equal(cardPillOf("__proto__"), "unknown");
assert.equal(setupLineOf("hasOwnProperty"), "generic");
assert.equal(setupLineOf(null), "generic");
assert.equal(setupLineOf(42), "generic");
// The derived card off: the same card as on, only the switch and the pill change.
{
  const on = connectorsListView({ page: MOCK_PAGES.derivedPaid, extraPrice: EUR, basePrice: BASE });
  const off = connectorsListView({ page: MOCK_PAGES.derivedOff, extraPrice: EUR, basePrice: BASE });
  if (on.kind !== "list" || off.kind !== "list") throw new Error("derived: lists");
  assert.deepEqual(
    { ...off.cards[0], enabled: true, pill: "online", lastCallAt: on.cards[0].lastCallAt },
    on.cards[0],
    "derived off = derived on but for the switch, the pill and the last call",
  );
  assert.deepEqual([off.cards[0].numberLine, off.cards[0].derived, off.cards[0].deletable], ["main", true, false]);
  const trial = connectorsListView({ page: MOCK_PAGES.derivedOffTrial, extraPrice: EUR, basePrice: BASE });
  assert.equal(trial.kind, "list", "derived off in a trial: still a list, never the empty card");
}
console.log("ok: the view table");

// ── 2. setup_incomplete: the amber pill + one line, fr/en/he ────────────────
const ISSUES: Array<[ConnectorView["setupIssue"] | string, SetupLine]> = [
  ["no_secret", "no_secret"],
  ["secret_unreadable", "secret_unreadable"],
  ["unsafe_url", "unsafe_url"],
  [undefined, "generic"],
  [UNKNOWN_ISSUE, "generic"],
];
for (const l of LOCALES) {
  const c = C(l);
  for (const [issue, line] of ISSUES) {
    const out = list(l, pageOf([withState(MOCK_LEGACY, "setup_incomplete", issue as string | undefined)]));
    const card = cardOf(out, "legacy");
    const pill = pillOf(card);
    assert.ok(pill, `${l} ${issue}: the pill`);
    assert.equal(pill[1].endsWith(AMBER.pill), true, `${l} ${issue}: amber pill classes`);
    assert.equal(pill[3], AMBER.dot, `${l} ${issue}: amber dot`);
    assert.equal(pill[4], esc(c.pill.setup_incomplete), `${l} ${issue}: "À terminer"`);
    assert.ok(!pill[1].includes(RED), `${l} ${issue}: never red`);
    // Exactly ONE line, the right one, in amber text.
    const lines = card.match(/data-setup-line="[^"]+"/g) ?? [];
    assert.deepEqual(lines, [`data-setup-line="${line}"`], `${l} ${issue}: one line`);
    assert.ok(card.includes(`text-[#92400e]" data-setup-line="${line}">${esc(c.setupLine[line])}</p>`), `${l} ${issue}: the copy`);
    assert.ok(!card.includes("data-unreachable-note") && !card.includes(RED), `${l} ${issue}: no red at all`);
    // The actions stay as they are: the derived card's live switch, Tester, Modifier.
    assert.ok(card.includes('data-actions="live"') && card.includes("data-edit-action"), `${l} ${issue}: Modifier stays`);
  }
  // Red stays only for "Agent injoignable".
  const three = list(l, MOCK_PAGES.rowsWithSetup);
  assert.ok(pillOf(cardOf(three, MOCK_UNREACHABLE.id))?.[1].includes(RED), `${l}: unreachable stays red`);
  assert.ok(!cardOf(three, MOCK_SETUP_ROW.id).includes(RED), `${l}: the setup row has no red`);
  assert.ok(cardOf(three, MOCK_SETUP_ROW.id).includes('data-setup-line="unsafe_url"'), `${l}: the setup row's line`);
}
// The VP's FR copy, verbatim.
assert.deepEqual(
  { pill: C("fr").pill.setup_incomplete, ...C("fr").setupLine },
  {
    pill: "À terminer",
    no_secret: "Générez un secret pour que votre agent réponde.",
    secret_unreadable: "Régénérez le secret de votre agent : l'ancien n'est plus utilisable.",
    unsafe_url: "Corrigez l'adresse de votre agent : elle ne peut pas être utilisée.",
    generic: "Ouvrez « Modifier » pour finir le réglage.",
  },
);
// The generic line names the card's own "Modifier" button, in every locale.
for (const l of LOCALES) assert.ok(C(l).setupLine.generic.includes(C(l).edit), `${l}: the generic line names "${C(l).edit}"`);
console.log("ok: setup_incomplete");

// ── 3. An unknown state: neutral pill + generic line, never a crash ─────────
for (const l of LOCALES) {
  const c = C(l);
  for (const issue of [undefined, "no_secret", UNKNOWN_ISSUE]) {
    const out = list(l, pageOf([withState(MOCK_LEGACY, UNKNOWN_STATE, issue)]));
    const card = cardOf(out, "legacy");
    assert.ok(card.includes('data-state="unknown"'), `${l} unknown: data-state`);
    const pill = pillOf(card);
    assert.ok(pill, `${l} unknown: a pill`);
    assert.ok(pill[1].endsWith(NEUTRAL.pill) && pill[3] === NEUTRAL.dot, `${l} unknown: neutral colours`);
    assert.equal(pill[4], esc(c.pill.unknown), `${l} unknown: the neutral word`);
    assert.ok(card.includes(`text-[#475569]" data-setup-line="generic">${esc(c.setupLine.generic)}</p>`), `${l} unknown: the generic line, neutral`);
    assert.ok(!card.includes(RED) && !card.includes("#92400e"), `${l} unknown: neither red nor amber`);
    assert.ok(!out.includes(UNKNOWN_STATE) && !out.includes(UNKNOWN_ISSUE), `${l} unknown: the raw value is never shown`);
  }
  // The whole mounted page survives it too, beside known cards.
  const page = owned(l, pageOf([withState(MOCK_ONLINE, UNKNOWN_STATE), MOCK_OFF]));
  assert.ok(page.includes('data-state="unknown"') && page.includes('data-state="off"'), `${l}: the page renders both cards`);
}
console.log("ok: an unknown state");

// ── 4. The derived card OFF: a normal "Éteint" card, never the empty state ──
for (const l of LOCALES) {
  const c = C(l);
  for (const name of ["derivedOff", "derivedOffTrial"] as const) {
    const out = owned(l, MOCK_PAGES[name]);
    assert.ok(!out.includes("data-connectors-empty") && !out.includes(esc(c.empty.title)), `${l} ${name}: not the empty state`);
    const card = cardOf(out, "legacy");
    assert.ok(card.includes('data-state="off"') && card.includes('data-derived="true"'), `${l} ${name}: derived, off`);
    assert.equal(pillOf(card)?.[4], esc(c.pill.off), `${l} ${name}: "Éteint"`);
    assert.ok(card.includes(`data-number-line="main">${esc(c.mainNumber)}</p>`), `${l} ${name}: "Répond sur votre numéro principal"`);
    assert.match(card, /<button type="button" role="switch" aria-checked="false" aria-label="[^"]+" class=/, `${l} ${name}: the switch, off and enabled`);
    assert.ok(card.includes('data-actions="live"') && !card.includes("data-actions-soon"), `${l} ${name}: live actions (switch back on, Tester, Modifier)`);
    assert.ok(!card.includes("data-card-menu") && !card.includes("data-setup-line"), `${l} ${name}: no "…", no setup line`);
    assert.ok(card.includes(esc(c.defaultName)) && card.includes(esc(c.noCall)), `${l} ${name}: the default name, no call`);
  }
}
// Switching it back on keeps the card, flips the pill; off again → "off".
{
  const on = withLegacyEnabled(MOCK_PAGES.derivedOff, true);
  assert.deepEqual([on.connectors[0].enabled, on.connectors[0].state], [true, "online"]);
  const off = withLegacyEnabled(on, false);
  assert.deepEqual([off.connectors.length, off.connectors[0].enabled, off.connectors[0].state], [1, false, "off"]);
}
console.log("ok: the derived card off");

// ── 5. Inert: what the server sends today shows no B7 markup ────────────────
const TODAY = ["emptyTrial", "emptyPaid", "emptyPaidOrdersOff", "derivedTrial", "derivedPaid", "derivedPaidOrdersOff", "threePaid", "threeClosed", "oneTrialLocked", "maxReached"] as const;
for (const name of TODAY) {
  const v = connectorsListView({ page: MOCK_PAGES[name], extraPrice: EUR, basePrice: BASE });
  if (v.kind === "list") for (const card of v.cards) assert.equal(card.setupLine, null, `${name}: no setup line`);
  for (const l of LOCALES) {
    const out = owned(l, MOCK_PAGES[name]);
    const c = C(l);
    for (const needle of ["data-setup-line", 'data-pill="setup_incomplete"', 'data-pill="unknown"', esc(c.pill.setup_incomplete), esc(c.pill.unknown), "#fde68a"]) {
      assert.ok(!out.includes(needle), `${l} ${name}: no ${needle}`);
    }
  }
}
// The derived card the server sends today is on: its card is byte-for-byte what it was (no new attribute).
assert.ok(!list("fr", MOCK_PAGES.derivedPaid).includes("setup"), "derived on: no setup markup");
console.log("ok: inert");

// ── 6. Exhaustiveness ───────────────────────────────────────────────────────
const PILLS = ["online", "off", "unreachable", "setup_incomplete", "unknown"] as const satisfies readonly CardPill[];
const LINES = ["no_secret", "secret_unreadable", "unsafe_url", "generic"] as const satisfies readonly SetupLine[];
// Compile-time: these lists cover the unions (tsc fails when one grows).
const pillsCovered: [Exclude<CardPill, (typeof PILLS)[number]>] extends [never] ? true : false = true;
const linesCovered: [Exclude<SetupLine, (typeof LINES)[number]>] extends [never] ? true : false = true;
assert.ok(pillsCovered && linesCovered);
for (const l of LOCALES) {
  const c = C(l);
  assert.deepEqual(Object.keys(c.pill).sort(), [...PILLS].sort(), `${l}: one word per pill, no more`);
  assert.deepEqual(Object.keys(c.setupLine).sort(), [...LINES].sort(), `${l}: one line per issue + generic, no more`);
  for (const k of PILLS) assert.ok(typeof c.pill[k] === "string" && c.pill[k].trim(), `${l}: pill.${k}`);
  for (const k of LINES) assert.ok(typeof c.setupLine[k] === "string" && c.setupLine[k].trim(), `${l}: setupLine.${k}`);
}
// HE copy is Hebrew (not a leftover FR/EN string).
for (const k of LINES) assert.match(C("he").setupLine[k], /[֐-׿]/, `he: setupLine.${k} is Hebrew`);
assert.match(C("he").pill.setup_incomplete, /[֐-׿]/);
// Each pill draws with its own colour table entry (the PILL / DOT records are Record<CardPill, …>).
{
  const src = read("components/connectors/ConnectorsList.tsx");
  assert.match(src, /const PILL: Record<CardPill, string>/);
  assert.match(src, /const DOT: Record<CardPill, string>/);
  const view = read("lib/connectors/list-view.ts");
  assert.match(view, /satisfies Record<ConnectorState, true>/);
  assert.match(view, /const never: never = pill;/);
}
console.log("ok: exhaustiveness");

// ── 7. The legacy switch re-reads the server's page ─────────────────────────
// PUT, then GET /api/dashboard/connectors (asUserId in the admin view); the
// switched state shows while the GET runs and stays if it fails.
type Call = { url: string; method: string; body: string | undefined };
type Answer = { status: number; body: unknown } | "throw";
function recorder(answers: Answer[]): { fetch: FetchLike; calls: Call[] } {
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
/** Runs the switch against a page state the way the panel does; returns every page shown. */
async function switchOn(start: ConnectorsPageView, enabled: boolean, answers: Answer[], asUserId: string | null = null) {
  const r = recorder(answers);
  let page = start;
  const shown: ConnectorsPageView[] = [];
  const result = await switchLegacyCard(connectorActions(r.fetch, asUserId), enabled, {
    saved: () => {
      page = withLegacyEnabled(page, enabled);
      shown.push(page);
    },
    reread: (p) => {
      page = p;
      shown.push(page);
    },
  });
  return { result, calls: r.calls, shown, page };
}
const runSwitch = async () => {
  const SETUP = MOCK_PAGES.derivedSetupNoSecret;
  for (const asUserId of [null, "u-tenant-1"] as const) {
    const qs = asUserId ? `?asUserId=${asUserId}` : "";
    const s = await switchOn(MOCK_PAGES.derivedOff, true, [TOOLS_OK, { status: 200, body: SETUP }], asUserId);
    assert.deepEqual(s.result, { ok: true, generated: null });
    assert.deepEqual(
      s.calls.map((c) => [c.method, c.url]),
      [
        ["PUT", `/api/dashboard/tools${qs}`],
        ["GET", `/api/dashboard/connectors${qs}`],
      ],
      `asUserId=${asUserId}: PUT then GET`,
    );
    assert.equal(s.calls[0].body, '{"tools":{"clientAgent":{"enabled":true}}}');
    // While the GET runs: the switched state; then the server's.
    assert.deepEqual(
      s.shown.map((p) => p.connectors[0].state),
      ["online", "setup_incomplete"],
      `asUserId=${asUserId}: optimistic, then the server's state`,
    );
    for (const l of LOCALES) {
      const card = cardOf(list(l, s.page), "legacy");
      assert.equal(pillOf(card)?.[2], "setup_incomplete", `${l}: the server's pill after switch-on`);
      assert.ok(pillOf(card)?.[1].endsWith(AMBER.pill) && card.includes('data-setup-line="no_secret"'), `${l}: amber pill + its line`);
    }
  }
  // The GET fails (status or network): the PUT's result stays, nothing new.
  for (const bad of [{ status: 500, body: null }, "throw"] as Answer[]) {
    const s = await switchOn(MOCK_PAGES.derivedOff, true, [TOOLS_OK, bad]);
    assert.deepEqual(s.result, { ok: true, generated: null });
    assert.deepEqual(s.calls.map((c) => c.method), ["PUT", "GET"]);
    assert.deepEqual(s.shown.map((p) => p.connectors[0].state), ["online"], "GET failed: the switched state only");
    assert.deepEqual(s.page, withLegacyEnabled(MOCK_PAGES.derivedOff, true));
  }
  // The PUT is refused: no GET, nothing shown.
  const refused = await switchOn(MOCK_PAGES.derivedPaid, false, [{ status: 500, body: null }]);
  assert.deepEqual(refused.result, { ok: false, refused: null });
  assert.deepEqual(refused.calls.map((c) => c.method), ["PUT"], "refused: no re-read");
  assert.deepEqual(refused.shown, []);
  // Switched off: the server's derived "off" card replaces the optimistic one.
  const off = await switchOn(MOCK_PAGES.derivedPaid, false, [TOOLS_OK, { status: 200, body: MOCK_PAGES.derivedOff }]);
  assert.deepEqual(off.page, JSON.parse(JSON.stringify(MOCK_PAGES.derivedOff)));
  // The panel's switch goes through switchLegacyCard (not a bare toggle).
  const panel = read("components/connectors/ConnectorsPanel.tsx");
  assert.match(panel, /await switchLegacyCard\(actions, enabled, \{/);
  assert.equal(panel.split("actions.toggle(").length - 1, 1, "toggle is called only inside switchLegacyCard");
  console.log("ok: the switch re-reads the server's page");
};

runSwitch().then(
  () => console.log("connectors-state-b7: OK"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
