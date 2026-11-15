// Campaign results: the "Captured from the conversation" block of one call.
// Labels and order from the campaign's CURRENT schema, missing items named,
// nothing at all when capture is off, never a technical key in the markup.
// Renders the REAL component to static HTML. Mock data only.
// Run with:  npx tsx scripts/tests/campaign-results-captured.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CapturedFromConversation } from "../../app/[locale]/dashboard/campaigns/captured-from-conversation";
import { capturedView, type CapturedView } from "../../lib/campaigns/capture";
import { capturedItems } from "../../lib/campaigns/captured-items";
import type { ExtractionField } from "../../lib/campaigns/constants";
import { resultsCallView, type ResultsCallRow } from "../../lib/campaigns/results-call-view";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const messages = (l: string) => JSON.parse(readFileSync(join(ROOT, `messages/${l}.json`), "utf8"));
const LOCALES = ["fr", "en", "he"] as const;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const SCHEMA: ExtractionField[] = [
  { key: "budget_eur", label: "Budget", type: "number" },
  { key: "decision_maker", label: "Décideur", type: "boolean" },
  { key: "best_slot", label: "Créneau préféré", type: "enum", options: ["Matin", "Soir"] },
  { key: "next_step", label: "Prochaine étape", type: "string", required: true },
];

// Stored payload as runCampaignCapture writes it; budget_eur absent; an old key no longer in the schema.
const STORED = {
  v: 1,
  source: "conversation",
  at: "2026-11-14T09:00:00.000Z",
  model: "mock-model",
  values: {
    next_step: "Rappeler <b>jeudi</b> & envoyer le devis",
    decision_maker: true,
    best_slot: "Soir",
    legacy_field_xyz: "old value",
  },
};
const CAPTURED: CapturedView = capturedView(STORED);

function html(props: { schema: ExtractionField[]; captured: CapturedView | undefined; captureOn: boolean }, locale = "fr") {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps,
      createElement(CapturedFromConversation, props),
    ),
  );
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const fr = messages("fr").DashboardCampaigns;

test("a captured value is shown with its label", () => {
  const out = html({ schema: SCHEMA, captured: CAPTURED, captureOn: true });
  assert.ok(out.includes(esc(fr.capturedTitle)), "title");
  assert.ok(out.includes(esc("Créneau préféré")) && out.includes(">Soir<"), "enum value under its label");
  assert.ok(out.includes(esc("Décideur")) && out.includes(`>${esc(fr.capturedYes)}<`), "boolean shown as Oui");
});

test("a captured value is escaped text, never markup", () => {
  const out = html({ schema: SCHEMA, captured: CAPTURED, captureOn: true });
  assert.ok(out.includes(esc("Rappeler <b>jeudi</b> & envoyer le devis")));
  assert.ok(!out.includes("<b>jeudi</b>"));
});

test("a missing value is named as missing, not hidden", () => {
  const items = capturedItems(SCHEMA, CAPTURED, true)!;
  assert.deepEqual(items.find((i) => i.key === "budget_eur"), { key: "budget_eur", label: "Budget", value: null });
  const out = html({ schema: SCHEMA, captured: CAPTURED, captureOn: true });
  const at = out.indexOf(">Budget<");
  assert.ok(at > 0, "Budget label present");
  assert.ok(out.slice(at, at + 400).includes(esc(fr.capturedMissing)), "Budget followed by 'non relevé'");
  assert.equal(out.split(esc(fr.capturedMissing)).length - 1, 1, "exactly one missing item");
});

test("an attempt that found nothing names every schema item as missing", () => {
  const out = html({ schema: SCHEMA, captured: capturedView({ ...STORED, values: {} }), captureOn: true });
  assert.equal(out.split(esc(fr.capturedMissing)).length - 1, SCHEMA.length);
});

test("items follow the schema order, under the CURRENT labels", () => {
  const items = capturedItems(SCHEMA, CAPTURED, true)!;
  assert.deepEqual(items.map((i) => i.key), SCHEMA.map((f) => f.key));
  const out = html({ schema: SCHEMA, captured: CAPTURED, captureOn: true });
  const pos = SCHEMA.map((f) => out.indexOf(`>${esc(f.label)}<`));
  assert.ok(pos.every((p) => p > 0));
  assert.deepEqual([...pos].sort((a, b) => a - b), pos);
  // Reversed schema → reversed block.
  const rev = capturedItems([...SCHEMA].reverse(), CAPTURED, true)!;
  assert.deepEqual(rev.map((i) => i.key), SCHEMA.map((f) => f.key).reverse());
  // A label renamed after the call shows its new text.
  const renamed = SCHEMA.map((f) => (f.key === "best_slot" ? { ...f, label: "Moment idéal" } : f));
  const out2 = html({ schema: renamed, captured: CAPTURED, captureOn: true });
  assert.ok(out2.includes("Moment idéal") && !out2.includes(esc("Créneau préféré")));
});

test("a captured key no longer in the schema is omitted", () => {
  const items = capturedItems(SCHEMA, CAPTURED, true)!;
  assert.ok(!items.some((i) => i.key === "legacy_field_xyz"));
  const out = html({ schema: SCHEMA, captured: CAPTURED, captureOn: true });
  assert.ok(!out.includes("old value"));
});

test("capture off renders nothing", () => {
  for (const l of LOCALES) {
    assert.equal(html({ schema: SCHEMA, captured: CAPTURED, captureOn: false }, l), "", `${l}: switch off`);
    assert.equal(html({ schema: SCHEMA, captured: undefined, captureOn: true }, l), "", `${l}: no captured field`);
    assert.equal(html({ schema: SCHEMA, captured: null, captureOn: true }, l), "", `${l}: no attempt`);
    assert.equal(html({ schema: [], captured: CAPTURED, captureOn: true }, l), "", `${l}: empty schema`);
  }
  // A pending claim is no attempt: nothing.
  const pending = capturedView({ v: 1, pending: true, claimedAt: "2026-11-14T09:00:00.000Z", token: "t", attempt: 1 });
  assert.equal(html({ schema: SCHEMA, captured: pending, captureOn: true }), "");
  // The server omits `captured` entirely when its switch is off.
  const row: ResultsCallRow = {
    id: "00000000-0000-0000-0000-000000000001",
    phoneNumber: "+972500000000",
    outcome: "connected",
    durationSeconds: 60,
    disposition: "",
    sentiment: "",
    summary: "",
    transcript: [],
    createdAt: new Date("2026-11-14T09:00:00.000Z"),
    extracted: STORED,
  };
  const offView = resultsCallView(row, "off") as { captured?: CapturedView };
  assert.equal(html({ schema: SCHEMA, captured: offView.captured, captureOn: true }), "");
  const onView = resultsCallView(row, "on") as { captured?: CapturedView };
  assert.ok(html({ schema: SCHEMA, captured: onView.captured, captureOn: true }).includes(">Soir<"));
});

test("no technical key in the markup", () => {
  for (const l of LOCALES) {
    const out = html({ schema: SCHEMA, captured: CAPTURED, captureOn: true }, l);
    for (const k of [...SCHEMA.map((f) => f.key), "legacy_field_xyz"]) {
      assert.ok(!out.includes(k), `${l}: key ${k} leaked`);
    }
  }
});

test("fr, en and he have the same captured keys, all non-empty", () => {
  const keysOf = (l: string) =>
    Object.keys(messages(l).DashboardCampaigns).filter((k) => k.startsWith("captured")).sort();
  const base = keysOf("fr");
  assert.deepEqual(base, ["capturedHint", "capturedMissing", "capturedNo", "capturedTitle", "capturedYes"]);
  for (const l of LOCALES) {
    assert.deepEqual(keysOf(l), base, l);
    for (const k of base) assert.ok(String(messages(l).DashboardCampaigns[k]).trim(), `${l}.${k}`);
  }
  assert.equal(fr.capturedTitle, "Relevé depuis la conversation");
  assert.equal(messages("en").DashboardCampaigns.capturedTitle, "Captured from the conversation");
});

console.log(`\n${passed} tests passed`);
