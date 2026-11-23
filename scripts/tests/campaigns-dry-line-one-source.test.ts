// The dry ("test mode") dispatcher line: ONE source wins. The line never
// shows a would-dial count next to the "outside call hours" chip.
//   - contactsDue > 0, skippedCallHours = 0   → the count line;
//   - contactsDue = 0, skippedCallHours > 0   → "0 calls (outside call hours)";
//   - both > 0                                → the count + a separate "waiting for call hours" figure;
//   - the snapshot says outside the window NOW → "0 calls (outside call hours)", whatever the tick says.
// Renders the REAL health block to static HTML. Mock data only.
// Run with:  npx tsx scripts/tests/campaigns-dry-line-one-source.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { IntlMessageFormat } from "intl-messageformat";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { dispatchWording, dryTickCounts, type DispatcherHealth } from "../../lib/campaigns/live-view";
import type { DispatchTick } from "../../lib/campaigns/live";
import { DispatcherHealthBlock } from "../../app/[locale]/dashboard/campaigns/campaign-live-console";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const AT = "2026-11-23T10:00:00.000Z";
function tick(contactsDue: number, skippedCallHours: number): DispatchTick {
  return {
    at: AT, source: "cron", mode: "dry", claimed: 0, dialed: 0, failed: 0, runningCampaigns: 2,
    wouldDial: { campaignsDue: contactsDue > 0 ? 1 : 0, contactsDue, skippedCallHours, skippedConcurrency: 0 },
  };
}
const oldDryTick = { at: AT, source: "cron", mode: "dry", claimed: 0, dialed: 0, failed: 0, runningCampaigns: 1 } as DispatchTick;

const COUNT = (contactsDue: number, waitingCallHours: number): DispatcherHealth =>
  ({ kind: "dryTick", line: "count", contactsDue, waitingCallHours });
const OUT: DispatcherHealth = { kind: "dryTick", line: "outsideCallHours" };

// ── 1. The table: (mode, tick, stale, outsideWindowNow) → health ─────
test("dispatchWording: one source wins (tick × outside-window-now)", () => {
  type Row = [label: string, tick: DispatchTick | null, stale: boolean, outsideNow: boolean, want: DispatcherHealth];
  const TABLE: Row[] = [
    ["due, none held by hours", tick(3, 0), false, false, COUNT(3, 0)],
    ["nothing due, held by hours", tick(0, 4), false, false, OUT],
    ["both", tick(3, 2), false, false, COUNT(3, 2)],
    ["nothing at all", tick(0, 0), false, false, COUNT(0, 0)],
    // the edge: the tick counted before the window closed, the snapshot says outside NOW
    ["VP capture: due 3, chip outside now", tick(3, 0), false, true, OUT],
    ["both, chip outside now", tick(3, 2), false, true, OUT],
    ["held by hours, chip outside now", tick(0, 4), false, true, OUT],
    ["old tick without counts", oldDryTick, false, false, { kind: "dryTick", line: "plain" }],
    ["old tick, chip outside now", oldDryTick, false, true, OUT],
    // alarms are not overridden by the chip
    ["stale, chip outside now", tick(3, 0), true, true, { kind: "stale" }],
    ["no tick, chip outside now", null, false, true, { kind: "neverRan" }],
  ];
  for (const [label, t, stale, outsideNow, want] of TABLE)
    assert.deepEqual(dispatchWording("dry", t, stale, outsideNow).health, want, label);
  // off stays hidden, a real tick stays today's line, the 4th argument defaults to false
  assert.deepEqual(dispatchWording("off", tick(3, 0), false, true).health, { kind: "hidden" });
  const real = { ...tick(3, 0), mode: "on" } as DispatchTick;
  assert.deepEqual(dispatchWording("on", real, false, true).health, { kind: "lastTick" });
  assert.deepEqual(dispatchWording("dry", tick(3, 0)).health, COUNT(3, 0));
});

test("dry tick reader: skippedCallHours read defensively, never folded into contactsDue", () => {
  assert.deepEqual(dryTickCounts(tick(0, 4)), { contactsDue: 0, skippedCallHours: 4 });
  assert.deepEqual(dryTickCounts(tick(3, 2)), { contactsDue: 3, skippedCallHours: 2 });
  assert.deepEqual(dryTickCounts({ ...oldDryTick, contactsDue: 1, skippedCallHours: 5 }), { contactsDue: 1, skippedCallHours: 5 });
  for (const bad of ["2", -1, Number.NaN, null])
    assert.deepEqual(
      dryTickCounts({ ...oldDryTick, wouldDial: { contactsDue: 1, skippedCallHours: bad } }),
      { contactsDue: 1, skippedCallHours: 0 },
      String(bad),
    );
});

// ── 2. Rendered, every locale ────────────────────────────────────────
function render(locale: string, t: DispatchTick, outsideNow: boolean) {
  function Harness() {
    const tr = useTranslations("DashboardCampaigns.live");
    return createElement(DispatcherHealthBlock, {
      health: dispatchWording("dry", t, false, outsideNow).health,
      tick: t,
      ago: () => "AGO",
      t: tr,
    });
  }
  const html = renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps, createElement(Harness)),
  );
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#x27;|&#39;/g, "'").trim();
}
const fmt = (l: string, key: string, v: Record<string, string | number>) =>
  new IntlMessageFormat(messages(l).DashboardCampaigns.live[key], l).format(v) as string;

test("VP capture: due 3 with the chip outside now → '0 (outside call hours)', never '3 calls'", () => {
  for (const l of LOCALES) {
    const out = render(l, tick(3, 0), true);
    assert.equal(out, fmt(l, "dryTickOutsideCallHours", { ago: "AGO" }), l);
    assert.ok(!out.includes("3"), `${l}: no 3 in ${out}`);
    assert.ok(!out.includes(fmt(l, "dryTickCount", { ago: "AGO", n: 3 })), `${l} no count line`);
  }
  assert.equal(render("fr", tick(3, 0), true), "Mode test : composeur passé AGO, 0 appel (hors heures d'appel).");
});

test("each row renders its own copy, the waiting figure separate from the count", () => {
  for (const l of LOCALES) {
    assert.equal(render(l, tick(3, 0), false), fmt(l, "dryTickCount", { ago: "AGO", n: 3 }), `${l} count`);
    assert.equal(render(l, tick(0, 4), false), fmt(l, "dryTickOutsideCallHours", { ago: "AGO" }), `${l} out`);
    const both = render(l, tick(3, 2), false);
    assert.equal(
      both,
      `${fmt(l, "dryTickCount", { ago: "AGO", n: 3 })} ${fmt(l, "dryTickWaitingCallHours", { m: 2 })}`,
      `${l} both`,
    );
    // the waiting figure is its own element, never inside the count sentence
    assert.ok(!fmt(l, "dryTickCount", { ago: "AGO", n: 3 }).includes("2"), `${l}`);
  }
  assert.equal(
    render("fr", tick(3, 2), false),
    "Mode test : composeur passé AGO, 3 appels auraient été passés. 2 en attente des heures d'appel",
  );
});

test("copy: fr/en/he, ICU plurals, no env or supplier name", () => {
  const want: Record<string, Record<number, string>> = {
    fr: { 1: "1 en attente des heures d'appel", 2: "2 en attente des heures d'appel" },
    en: { 1: "1 waiting for call hours", 2: "2 waiting for call hours" },
    he: { 1: "אחד ממתין לשעות החיוג", 2: "2 ממתינים לשעות החיוג" },
  };
  for (const l of LOCALES) {
    const live = messages(l).DashboardCampaigns.live;
    for (const k of ["dryTickOutsideCallHours", "dryTickWaitingCallHours"]) assert.equal(typeof live[k], "string", `${l} ${k}`);
    assert.match(live.dryTickWaitingCallHours, /\{m, plural,/, `${l} ICU plural`);
    for (const [m, s] of Object.entries(want[l])) assert.equal(fmt(l, "dryTickWaitingCallHours", { m: Number(m) }), s, `${l} ${m}`);
    for (const m of [0, 1, 2, 5, 11, 21]) assert.ok(!fmt(l, "dryTickWaitingCallHours", { m }).includes("{"), `${l} ${m}`);
    assert.doesNotMatch(JSON.stringify([live.dryTickOutsideCallHours, live.dryTickWaitingCallHours]), /CAMPAIGN_DISPATCH|twilio|livekit|dry/i, l);
  }
  assert.equal(fmt("en", "dryTickOutsideCallHours", { ago: "1 min ago" }), "Test mode: dialer ran 1 min ago, 0 calls (outside call hours).");
  assert.equal(fmt("he", "dryTickOutsideCallHours", { ago: "X" }), "מצב בדיקה: החייגן רץ X, 0 שיחות (מחוץ לשעות החיוג).");
});

test("the console feeds the chip's own source into the wording", () => {
  const src = read("app/[locale]/dashboard/campaigns/campaign-live-console.tsx");
  assert.match(src, /dispatchWording\(mode, tick, tickStale, dispatcher\.blockers\.includes\("outside_call_window"\)\)/);
  // the chips are drawn from the same array
  assert.match(src, /dispatcher\.blockers\.map\(\(b\) =>/);
});

if (failures) {
  console.error(`\n${failures} CAMPAIGNS-DRY-LINE TEST(S) FAILED`);
  process.exit(1);
}
console.log("ALL CAMPAIGNS-DRY-LINE TESTS PASSED");
