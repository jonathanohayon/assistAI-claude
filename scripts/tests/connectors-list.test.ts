// The connectors LIST (C1): the pure view (lib/connectors/list-view.ts) and
// its cards (components/connectors/ConnectorsList.tsx), over the typed mock
// (lib/connectors/mock.ts). UI only: no request anywhere.
//   1. The view table: every state × trial/paid × canAdd reason.
//   2. Render per state in fr/en/he (the copy comes from messages).
//   3. The extra-connector price is the INPUT's (change it → the text
//      changes), written like the pricing screens (formatGridMoney).
//   4. The derived card: no delete, no number, "Répond sur votre numéro principal".
//   5. Unreachable: the red pill + "Tamara répond seule en attendant.".
//   6. The empty state: one large card, never an empty page; paid with
//      PRODUCT_ORDERS off and 0 connectors is OPEN (the first is included).
//   7. An empty / blank name shows the localized default name.
//   8. The delete dialog: the number line + the billing line.
//   9. The live Connect page is unchanged: it mounts none of this.
//  10. Source guards: the mock is imported by no live code; no file under
//      app/ names a fixture or imports the mock.
// Run with:  npx tsx scripts/tests/connectors-list.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ConnectPageContent } from "../../app/[locale]/dashboard/agent/connect-view";
import {
  AddConnectorCard,
  ConnectorsList,
  DeleteConnectorDialog,
  EmptyConnectorsCard,
} from "../../components/connectors/ConnectorsList";
import {
  connectorsListView,
  formatConnectorPrice,
  type AddCardView,
  type ConnectorExtraPrice,
  type ConnectorsListView,
} from "../../lib/connectors/list-view";
import { MOCK_EXTRA_PRICE, MOCK_LEGACY, MOCK_NOW, MOCK_OFF, MOCK_ONLINE, MOCK_PAGES, MOCK_UNREACHABLE } from "../../lib/connectors/mock";
import type { ConnectorsPageView, ConnectorView } from "../../lib/connectors/types";
import { formatGridMoney } from "../../lib/pricing-grid";
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
const count = (s: string, needle: string) => s.split(needle).length - 1;
const list = (l: Locale, page: ConnectorsPageView, extraPrice: ConnectorExtraPrice | null = MOCK_EXTRA_PRICE.EUR) =>
  html(l, createElement(ConnectorsList, { page, extraPrice, now: MOCK_NOW }));

const EUR = MOCK_EXTRA_PRICE.EUR;

// ── 1. The view table ───────────────────────────────────────────────────────
const p = (
  connectors: ConnectorView[],
  inTrial: boolean,
  canAdd: ConnectorsPageView["canAdd"],
  max = inTrial ? 1 : 5,
): ConnectorsPageView => ({ connectors, limits: { max, used: connectors.length, inTrial }, canAdd });

type Row = [name: string, page: ConnectorsPageView, kind: ConnectorsListView["kind"], add: AddCardView];
const TABLE: Row[] = [
  ["trial, 0, ok", p([], true, { ok: true }), "empty", { kind: "add", price: EUR }],
  ["trial, derived, trial_limit", p([MOCK_LEGACY], true, { ok: false, reason: "trial_limit" }), "list", { kind: "trial", max: 1 }],
  ["trial, 1, trial_limit", p([MOCK_ONLINE], true, { ok: false, reason: "trial_limit" }), "list", { kind: "trial", max: 1 }],
  ["trial, 0, trial_limit (max 0)", p([], true, { ok: false, reason: "trial_limit" }, 0), "empty", { kind: "trial", max: 0 }],
  ["paid, 0, ok", p([], false, { ok: true }), "empty", { kind: "add", price: EUR }],
  // VP: the first connector is included, so PRODUCT_ORDERS off does not block it (the BE says ok).
  ["paid, 0, PRODUCT_ORDERS off → ok", MOCK_PAGES.emptyPaidOrdersOff, "empty", { kind: "add", price: EUR }],
  ["paid, derived, ok", p([MOCK_LEGACY], false, { ok: true }), "list", { kind: "add", price: EUR }],
  ["paid, derived, orders_closed", p([MOCK_LEGACY], false, { ok: false, reason: "orders_closed" }), "list", { kind: "soon" }],
  ["paid, 3, ok", p([MOCK_ONLINE, MOCK_OFF, MOCK_UNREACHABLE], false, { ok: true }), "list", { kind: "add", price: EUR }],
  ["paid, 3, orders_closed", p([MOCK_ONLINE, MOCK_OFF, MOCK_UNREACHABLE], false, { ok: false, reason: "orders_closed" }), "list", { kind: "soon" }],
  ["paid, 3, max_reached (max 3)", p([MOCK_ONLINE, MOCK_OFF, MOCK_UNREACHABLE], false, { ok: false, reason: "max_reached" }, 3), "list", { kind: "max", max: 3 }],
  ["paid, 5, max_reached", MOCK_PAGES.maxReached, "list", { kind: "max", max: 5 }],
  ["paid, 0, orders_closed (BE is the source of truth)", p([], false, { ok: false, reason: "orders_closed" }), "empty", { kind: "soon" }],
  ["paid, 1, refused without reason", p([MOCK_ONLINE], false, { ok: false }), "list", { kind: "max", max: 5 }],
];
for (const [name, page, kind, add] of TABLE) {
  const v = connectorsListView({ page, extraPrice: EUR });
  assert.equal(v.kind, kind, `${name}: ${kind}`);
  assert.deepEqual(v.add, add, `${name}: add card`);
  if (page.canAdd.ok) assert.equal(v.add.kind, "add", `${name}: canAdd.ok is never locked, never "Bientôt"`);
}
// canAdd.ok → never "soon", for every mock page and both prices.
for (const [name, page] of Object.entries(MOCK_PAGES)) {
  for (const price of [EUR, null]) {
    const v = connectorsListView({ page, extraPrice: price });
    if (page.canAdd.ok) assert.deepEqual(v.add, { kind: "add", price }, `${name}: open add card`);
    else assert.notEqual(v.add.kind, "add", `${name}: refused → locked`);
  }
}

// The cards, field by field.
{
  const v = connectorsListView({ page: MOCK_PAGES.threePaid, extraPrice: EUR });
  assert.equal(v.kind, "list");
  if (v.kind !== "list") throw new Error("unreachable");
  assert.deepEqual(
    v.cards.map((c) => [c.id, c.pill, c.unreachableNote, c.numberLine, c.number, c.canDelete, c.enabled, c.mode]),
    [
      [MOCK_ONLINE.id, "online", false, "own", "+972500000001", false, true, "lead"],
      [MOCK_OFF.id, "off", false, "own", "+33199000002", true, false, "voice"],
      [MOCK_UNREACHABLE.id, "unreachable", true, "own", "+972500000003", true, true, "voice"],
    ],
    "three cards: pill, note, number, delete only after the first",
  );
  assert.equal(v.cards[1].numberLabel, "Paris");
  const d = connectorsListView({ page: MOCK_PAGES.derivedPaid, extraPrice: EUR });
  if (d.kind !== "list") throw new Error("derived: a list");
  assert.deepEqual(
    { name: d.cards[0].name, number: d.cards[0].number, line: d.cards[0].numberLine, del: d.cards[0].canDelete, derived: d.cards[0].derived },
    { name: null, number: null, line: "main", del: false, derived: true },
    "derived: default name, no number, main-number line, no delete",
  );
  // The derived card is never deletable, wherever it sits in the list.
  const d3 = connectorsListView({ page: p([MOCK_ONLINE, MOCK_LEGACY], false, { ok: true }), extraPrice: EUR });
  if (d3.kind !== "list") throw new Error("d3");
  assert.equal(d3.cards[1].canDelete, false, "derived card at index 1: still no delete");
  // A derived card that would carry a number still shows the main-number line, never a number.
  const d2 = connectorsListView({ page: p([{ ...MOCK_LEGACY, numberE164: "+972500000009" }], false, { ok: true }), extraPrice: EUR });
  if (d2.kind !== "list") throw new Error("d2");
  assert.equal(d2.cards[0].number, null);
  assert.equal(d2.cards[0].numberLine, "main");
  // A real connector without a number yet.
  const n = connectorsListView({ page: MOCK_PAGES.maxReached, extraPrice: EUR });
  if (n.kind !== "list") throw new Error("n");
  assert.equal(n.cards[3].numberLine, "none");
  assert.equal(n.cards[3].number, null);
  // Blank names → the default name.
  for (const blank of ["", "   ", "\t"]) {
    const b = connectorsListView({ page: p([MOCK_ONLINE, { ...MOCK_OFF, name: blank }], false, { ok: true }), extraPrice: EUR });
    if (b.kind !== "list") throw new Error("b");
    assert.equal(b.cards[1].name, null, `blank name ${JSON.stringify(blank)} → default`);
    assert.equal(b.cards[0].name, "Agent ventes");
  }
}

// ── 2. Render per state in fr/en/he ─────────────────────────────────────────
for (const l of LOCALES) {
  const c = C(l);
  // Three connectors: online, off, unreachable; paid, open.
  const three = list(l, MOCK_PAGES.threePaid);
  assert.equal(count(three, "data-connector="), 3, `${l}: three cards`);
  for (const k of ["online", "off", "unreachable"] as const) assert.ok(three.includes(`>${esc(c.pill[k])}</span>`), `${l}: pill ${k}`);
  assert.equal(count(three, "data-pill="), 3, `${l}: ONE pill per card`);
  assert.ok(three.includes(esc(c.mode.lead)) && three.includes(esc(c.mode.voice)), `${l}: the mode sentences`);
  assert.ok(three.includes(esc(c.noCall)), `${l}: "Aucun appel pour l'instant"`);
  assert.ok(three.includes(esc(c.lastCall.split("{when}")[0])), `${l}: "Dernier appel : …"`);
  assert.equal(count(three, 'role="switch"'), 3, `${l}: a switch per card`);
  assert.equal(count(three, `>${esc(c.test)}</button>`), 3, `${l}: Tester per card`);
  assert.equal(count(three, `>${esc(c.edit)}</button>`), 3, `${l}: Modifier per card`);
  assert.equal(count(three, 'data-delete="true"'), 2, `${l}: Supprimer on all but the first`);
  assert.ok(three.includes('>+972 50-000-0001</span>') && three.includes(">+33 1 99 00 00 02</span>"), `${l}: numbers, grouped`);
  assert.ok(three.includes('dir="ltr"'), `${l}: the number reads left to right`);
  assert.equal(count(three, `>${esc(c.copyNumber)}</span>`), 3, `${l}: copy per number`);
  assert.ok(three.includes(esc(c.add.title)), `${l}: the add card`);
  assert.ok(three.indexOf('data-add-card="add"') > three.lastIndexOf("data-connector="), `${l}: the add card is LAST`);
  assert.ok(three.includes('aria-checked="false"') && three.includes('aria-checked="true"'), `${l}: switch states`);

  // Trial-locked add.
  const trial = list(l, MOCK_PAGES.oneTrialLocked);
  assert.ok(trial.includes('data-add-card="trial"') && trial.includes('aria-disabled="true"'), `${l}: trial add greyed`);
  const trialLine = l === "fr" ? "1 agent pendant l&#x27;essai. Activez votre offre pour en ajouter." : null;
  if (trialLine) assert.ok(trial.includes(trialLine), "fr: the VP's trial line, verbatim");
  assert.ok(!trial.includes("data-add-price"), `${l}: no price when trial-locked`);

  // orders_closed.
  const closed = list(l, MOCK_PAGES.threeClosed);
  assert.ok(closed.includes(`data-add-lock="soon">${esc(c.add.soon)}</span>`), `${l}: "Bientôt"`);
  assert.equal(c.add.soon, messages(l).DashboardNav.stateSoon, `${l}: the sidebar's word`);
  assert.ok(!closed.includes("data-add-price"), `${l}: no price when closed`);

  // max_reached: greyed + a plain line with the max.
  const max = list(l, MOCK_PAGES.maxReached);
  assert.ok(max.includes('data-add-card="max"') && max.includes('data-add-lock="max"'), `${l}: max greyed`);
  assert.ok(max.includes("5"), `${l}: the max`);
  if (l === "fr") assert.ok(max.includes("5 agents au maximum sur votre compte."), "fr: the max line");

  // Derived alone, paid and trial.
  const der = list(l, MOCK_PAGES.derivedPaid);
  assert.ok(der.includes(`>${esc(c.defaultName)}</h3>`), `${l}: the derived card's default name`);
  assert.ok(der.includes(esc(c.mainNumber)), `${l}: "Répond sur votre numéro principal"`);
  assert.ok(!der.includes('data-number="true"') && !der.includes(esc(c.copyNumber)), `${l}: derived, no number, no copy`);
  assert.ok(!der.includes("data-delete"), `${l}: derived, no delete`);
  assert.equal(count(der, 'role="switch"'), 1, `${l}: derived keeps its switch`);
  assert.ok(list(l, MOCK_PAGES.derivedPaidOrdersOff).includes('data-add-lock="soon"'), `${l}: second connector while closed → Bientôt`);

  // Unreachable: red pill + its line, only on that card.
  const un = list(l, p([MOCK_UNREACHABLE, MOCK_ONLINE], false, { ok: true }));
  assert.match(un, /data-pill="unreachable"/);
  assert.ok(un.includes("bg-[#fef2f2] text-[#b91c1c]") && un.includes("bg-[#dc2626]"), `${l}: the pill is red`);
  assert.equal(count(un, `data-unreachable-note="true">${esc(c.unreachableNote)}</p>`), 1, `${l}: the line once`);
  if (l !== "en") assert.ok(c.unreachableNote.includes("Tamara"), `${l}: "Tamara" in Latin letters`);

  // Empty.
  for (const name of ["emptyTrial", "emptyPaid", "emptyPaidOrdersOff"] as const) {
    const e = list(l, MOCK_PAGES[name]);
    assert.ok(e.includes("data-connectors-empty"), `${l} ${name}: the empty card`);
    assert.ok(e.includes(`>${esc(c.empty.title)}</h2>`), `${l} ${name}: "Branchez votre premier agent"`);
    assert.ok(e.includes(`data-empty-cta="true">${esc(c.empty.cta)}</button>`), `${l} ${name}: open (the first is included)`);
    assert.ok(!e.includes("data-connectors-list") && !e.includes("data-add-card") && !e.includes("data-add-lock"), `${l} ${name}: one card only, no lock`);
  }
  const eClosed = html(l, createElement(EmptyConnectorsCard, { add: { kind: "soon" } }));
  assert.ok(eClosed.includes(`>${esc(c.empty.title)}</h2>`) && eClosed.includes('data-add-lock="soon"') && !eClosed.includes("data-empty-cta"), `${l}: empty + BE refusal → the lock, still a card`);

  // HE copy: Tamara in Latin letters, never the Hebrew spelling.
  if (l === "he") assert.ok(!JSON.stringify(c).includes("תמרה"), "he: no Hebrew spelling of the brand");

  // Every key of the namespace exists in all three locales.
  const keys = (o: unknown, pre = ""): string[] =>
    Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (typeof v === "object" && v ? keys(v, `${pre}${k}.`) : [`${pre}${k}`]));
  assert.deepEqual(keys(c).sort(), keys(C("fr")).sort(), `${l}: same keys as fr`);
}

// The VP's FR copy, verbatim.
{
  const fr = C("fr");
  assert.equal(fr.pill.online, "En ligne");
  assert.equal(fr.pill.off, "Éteint");
  assert.equal(fr.pill.unreachable, "Agent injoignable");
  assert.equal(fr.unreachableNote, "Tamara répond seule en attendant.");
  assert.equal(fr.mainNumber, "Répond sur votre numéro principal");
  assert.equal(fr.noCall, "Aucun appel pour l'instant");
  assert.equal(fr.empty.title, "Branchez votre premier agent");
  assert.equal(fr.defaultName, "Votre agent");
  assert.equal(C("en").defaultName, "Your agent");
  assert.equal(C("he").defaultName, "הסוכן שלכם");
  assert.equal(fr.deleteDialog.released, "Le numéro {number} sera libéré et ne pourra pas être récupéré.");
  assert.equal(fr.deleteDialog.billing, "Il reste actif jusqu'à la fin de la période payée, sans remboursement.");
  // The relative date, rendered.
  const out = list("fr", MOCK_PAGES.threePaid);
  assert.ok(out.includes("Dernier appel : il y a 2 heures"), "fr: relative date of the last call");
}

// ── 3. The price is the input's, written like the pricing screens ───────────
for (const l of LOCALES) {
  for (const monthly of [19, 23, 19.5]) {
    for (const currency of ["EUR", "ILS"] as const) {
      const price = { monthly, currency };
      assert.equal(formatConnectorPrice(price, l), formatGridMoney(monthly, currency, l), `${l} ${currency} ${monthly}: same as the pricing grid`);
      const out = html(l, createElement(AddConnectorCard, { add: { kind: "add", price } }));
      const want = esc(C(l).add.price.replace("{price}", formatGridMoney(monthly, currency, l)));
      assert.ok(out.includes(`data-add-price="true">${want}</span>`), `${l} ${currency} ${monthly}: the price line follows the input`);
    }
  }
  const a = list(l, MOCK_PAGES.threePaid, { monthly: 19, currency: "EUR" });
  const b = list(l, MOCK_PAGES.threePaid, { monthly: 29, currency: "EUR" });
  assert.notEqual(a, b, `${l}: changing the amount changes the text`);
  assert.ok(b.includes(formatGridMoney(29, "EUR", l)) && !b.includes(formatGridMoney(19, "EUR", l)), `${l}: 29, not 19`);
  const none = list(l, MOCK_PAGES.threePaid, null);
  assert.ok(none.includes(`data-add-price="true">${esc(C(l).add.noPrice)}</span>`), `${l}: no amount → no price, never a default`);
}
assert.ok(list("fr", MOCK_PAGES.threePaid).includes(`+ ${formatGridMoney(19, "EUR", "fr")}/mois par agent, numéro inclus`), "fr: the VP's price line");
assert.ok(list("he", MOCK_PAGES.threePaid, MOCK_EXTRA_PRICE.ILS).includes("₪"), "he: ILS");
// No amount literal in the list's code: every amount comes from the input.
for (const f of ["components/connectors/ConnectorsList.tsx", "lib/connectors/list-view.ts"]) {
  assert.doesNotMatch(read(f), /\b(19|79|49|199)\b/, `${f}: no price literal`);
}

// ── 8. The delete dialog ────────────────────────────────────────────────────
for (const l of LOCALES) {
  const d = C(l).deleteDialog;
  const out = html(l, createElement(DeleteConnectorDialog, { name: "Support FR", number: "+33199000002", onCancel() {}, onConfirm() {} }));
  assert.ok(out.includes('role="alertdialog"'), `${l}: an alert dialog`);
  assert.ok(out.includes(esc(d.released.replace("{number}", "⁦+33 1 99 00 00 02⁩"))), `${l}: the released line with the number`);
  assert.ok(out.includes(esc(d.billing)), `${l}: the billing line`);
  assert.ok(out.includes(`>${esc(d.cancel)}</button>`) && out.includes(`>${esc(d.confirm)}</button>`), `${l}: cancel + confirm`);
  const noNum = html(l, createElement(DeleteConnectorDialog, { name: "X", number: null, onCancel() {}, onConfirm() {} }));
  assert.ok(!noNum.includes("data-delete-released") && noNum.includes("data-delete-billing"), `${l}: no number → no released line`);
}

// ── 9. The live Connect page is unchanged ───────────────────────────────────
// It mounts nothing of the list: its files import none of it, and its
// rendered HTML (brick and preview, fr/en/he) holds none of the list's copy.
for (const f of ["app/[locale]/dashboard/agent/page.tsx", "app/[locale]/dashboard/agent/connect-view.tsx", "app/[locale]/dashboard/agent/connect-owned.tsx"]) {
  assert.doesNotMatch(read(f), /connectors\/|ConnectorsList/, `${f}: imports nothing of the connectors list`);
}
const TERMS = { days: PRODUCT_TRIAL_DAYS, minutes: PRODUCT_TRIAL_MINUTES };
for (const l of LOCALES) {
  const c = C(l);
  const marks = [c.empty.title, c.add.title, c.mainNumber, c.unreachableNote, c.pill.unreachable];
  for (const view of [{ kind: "brick" } as const, { kind: "preview", cta: "soon", notify: true, adminNote: false } as const]) {
    const out = html(l, createElement(ConnectPageContent, { view, title: messages(l).DashboardNav.connect, trialNote: null, trialTerms: TERMS }));
    for (const m of marks) assert.ok(!out.includes(esc(m)), `${l} ${view.kind}: live page has no "${m}"`);
    assert.ok(!/data-connectors|data-connector=|data-add-card/.test(out), `${l} ${view.kind}: no list markup`);
  }
}

// ── 10. Source guards ───────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, e);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(tsx?|mjs|js)$/.test(e)) out.push(rel);
  }
  return out;
}
const LIVE = [...walk("app"), ...walk("components"), ...walk("lib")];
const IMPORTS_MOCK = /from\s+["'][^"']*connectors\/mock["']|import\(\s*["'][^"']*connectors\/mock["']\s*\)|require\(\s*["'][^"']*connectors\/mock["']/;
const offenders = LIVE.filter((f) => f !== "lib/connectors/mock.ts" && IMPORTS_MOCK.test(read(f)));
assert.deepEqual(offenders, [], "the connectors mock is imported by no live code (tests only)");
const fixtureFiles = walk("app").filter((f) => /fixture/i.test(f) || /fixture/i.test(read(f)));
assert.deepEqual(fixtureFiles, [], "no file under app/ names a fixture (capture routes are never committed)");
// The guard itself catches what it must (mutation proof, in memory).
assert.ok(IMPORTS_MOCK.test('import { MOCK_PAGES } from "@/lib/connectors/mock";'));
assert.ok(IMPORTS_MOCK.test("const m = await import('../../lib/connectors/mock');"));
assert.ok(!IMPORTS_MOCK.test('import type { ConnectorView } from "@/lib/connectors/types";'));
// The view and the list stay client-safe: type-only imports in the view, no server module in either.
assert.doesNotMatch(read("lib/connectors/list-view.ts").replace(/^import type .*$/gm, ""), /^import /m, "list-view: type imports only");
assert.doesNotMatch(read("components/connectors/ConnectorsList.tsx"), /lib\/db|next\/headers|server-only|connectors\/mock|pricing-grid/, "ConnectorsList: client-safe");

console.log("connectors-list: all assertions passed");
