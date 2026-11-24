// The dry ("test mode") dispatcher line: ONE source wins, and each console
// shows ONLY its own campaign's numbers (wouldDial.byCampaign[id], never the
// global totals). The line never shows a count next to the "outside call hours" chip.
//   - due > 0, heldByHours = 0                 → the count line;
//   - due = 0, heldByHours > 0                 → "0 calls (outside call hours)";
//   - both > 0                                 → the count + a separate "waiting for call hours" figure;
//   - the snapshot says outside the window NOW → "0 calls (outside call hours)", whatever the tick says;
//   - absent from a tick with byCampaign       → 0 / 0 (count line, n = 0);
//   - an old tick without byCampaign           → the plain line, no figure;
//   - "{ago}" = the entry's own `at` (a campaign start merged it in), else the tick's.
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
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
type Entry = { due: number; heldByHours: number; heldByConcurrency?: number; at?: string };
/** A start-merged entry's own instant (the tick's `at` stays the cron's). */
const START_AT = "2026-11-23T10:00:40.000Z";
/** A cron dry tick: global totals deliberately DIFFERENT from any one campaign's entry. */
function tickOf(by: Record<string, Entry>): DispatchTick {
  return {
    at: AT, source: "cron", mode: "dry", claimed: 0, dialed: 0, failed: 0, runningCampaigns: 5,
    wouldDial: {
      campaignsDue: 4, contactsDue: 40, skippedCallHours: 20, skippedConcurrency: 7,
      byCampaign: Object.fromEntries(Object.entries(by).map(([k, e]) => [k, { heldByConcurrency: 0, ...e }])),
    },
  };
}
/** Only A in the tick: `tick(3, 0)` = A due 3, held by hours 0. */
const tick = (due: number, heldByHours: number) => tickOf({ [A]: { due, heldByHours } });
const oldDryTick = {
  at: AT, source: "cron", mode: "dry", claimed: 0, dialed: 0, failed: 0, runningCampaigns: 1,
  wouldDial: { campaignsDue: 1, contactsDue: 3, skippedCallHours: 2, skippedConcurrency: 0 },
} as DispatchTick;

const COUNT = (contactsDue: number, waitingCallHours: number, at = AT): DispatcherHealth =>
  ({ kind: "dryTick", line: "count", at, contactsDue, waitingCallHours });
const OUT = (at = AT): DispatcherHealth => ({ kind: "dryTick", line: "outsideCallHours", at });
const PLAIN: DispatcherHealth = { kind: "dryTick", line: "plain", at: AT };

// ── 1. The table: (mode, tick, stale, outsideWindowNow, campaignId) → health ─
test("dispatchWording: one source wins, this campaign's entry only", () => {
  type Row = [label: string, tick: DispatchTick | null, stale: boolean, outsideNow: boolean, id: string | null, want: DispatcherHealth];
  const both = tickOf({ [A]: { due: 3, heldByHours: 0 }, [B]: { due: 0, heldByHours: 2 } });
  // A restarted after the cron tick: its entry carries its own `at`, B keeps the cron's numbers
  const restarted = tickOf({ [A]: { due: 3, heldByHours: 0, at: START_AT }, [B]: { due: 0, heldByHours: 2 } });
  const TABLE: Row[] = [
    ["due, none held by hours", tick(3, 0), false, false, A, COUNT(3, 0)],
    ["nothing due, held by hours", tick(0, 4), false, false, A, OUT()],
    ["both on the same campaign", tick(3, 2), false, false, A, COUNT(3, 2)],
    ["entry 0/0", tick(0, 0), false, false, A, COUNT(0, 0)],
    // two campaigns: each sees only its own numbers
    ["two campaigns, A's view", both, false, false, A, COUNT(3, 0)],
    ["two campaigns, B's view", both, false, true, B, OUT()],
    ["two campaigns, B's view, tick only", both, false, false, B, OUT()],
    // absent id = 0 / 0, whatever the globals say
    ["absent id", tick(3, 2), false, false, B, COUNT(0, 0)],
    // a start-merged entry: "{ago}" from its own `at`; the others keep the cron's numbers and time
    ["restarted A: its own at", restarted, false, false, A, COUNT(3, 0, START_AT)],
    ["restarted A, chip outside now: its own at", restarted, false, true, A, OUT(START_AT)],
    ["B after A's restart: cron numbers, cron at", restarted, false, true, B, OUT()],
    ["B after A's restart, tick only", restarted, false, false, B, OUT()],
    ["entry with a bad at: the tick's", tickOf({ [A]: { due: 3, heldByHours: 0, at: "nope" } }), false, false, A, COUNT(3, 0)],
    // the edge: the tick counted before the window closed, the snapshot says outside NOW
    ["VP capture: due 3, chip outside now", tick(3, 0), false, true, A, OUT()],
    ["held by hours, chip outside now", tick(0, 4), false, true, A, OUT()],
    // never the global totals
    ["old tick without byCampaign", oldDryTick, false, false, A, PLAIN],
    ["old tick, chip outside now", oldDryTick, false, true, A, OUT()],
    ["no campaign id", tick(3, 2), false, false, null, PLAIN],
    // alarms are not overridden by the chip; staleness is the caller's, on the tick's own at
    ["stale, chip outside now", tick(3, 0), true, true, A, { kind: "stale" }],
    ["stale, fresh start entry", restarted, true, false, A, { kind: "stale" }],
    ["no tick, chip outside now", null, false, true, A, { kind: "neverRan" }],
  ];
  for (const [label, t, stale, outsideNow, id, want] of TABLE)
    assert.deepEqual(dispatchWording("dry", t, stale, outsideNow, id).health, want, label);
  // off stays hidden, a real tick stays today's line, optional arguments default to "no figure"
  assert.deepEqual(dispatchWording("off", tick(3, 0), false, true, A).health, { kind: "hidden" });
  const real = { ...tick(3, 0), mode: "on" } as DispatchTick;
  assert.deepEqual(dispatchWording("on", real, false, true, A).health, { kind: "lastTick" });
  assert.deepEqual(dispatchWording("dry", tick(3, 0)).health, PLAIN);
});

test("dry tick reader: this campaign's entry, read defensively, never the globals", () => {
  assert.deepEqual(dryTickCounts(tick(0, 4), A), { mine: { due: 0, heldByHours: 4, at: null } });
  assert.deepEqual(dryTickCounts(tick(3, 2), A), { mine: { due: 3, heldByHours: 2, at: null } });
  assert.deepEqual(dryTickCounts(tick(3, 2), B), { mine: { due: 0, heldByHours: 0, at: null } });
  assert.deepEqual(
    dryTickCounts(tickOf({ [A]: { due: 1, heldByHours: 0, at: START_AT } }), A),
    { mine: { due: 1, heldByHours: 0, at: START_AT } },
  );
  for (const badAt of [12, "", "not a date"])
    assert.deepEqual(
      dryTickCounts(tickOf({ [A]: { due: 1, heldByHours: 0, at: badAt as string } }), A),
      { mine: { due: 1, heldByHours: 0, at: null } },
      String(badAt),
    );
  // the start source no longer matters: an absent id is 0 / 0
  assert.deepEqual(dryTickCounts({ ...tick(3, 0), source: "start" }, B), { mine: { due: 0, heldByHours: 0, at: null } });
  assert.deepEqual(dryTickCounts(oldDryTick, A), { mine: null });
  assert.deepEqual(dryTickCounts({ ...oldDryTick, wouldDial: { byCampaign: [] } }, A), { mine: null }, "array");
  assert.deepEqual(dryTickCounts({ ...oldDryTick, wouldDial: { byCampaign: { [A]: null } } }, A), { mine: { due: 0, heldByHours: 0, at: null } });
  // prototype keys are not entries
  assert.deepEqual(dryTickCounts(tick(3, 0), "__proto__"), { mine: { due: 0, heldByHours: 0, at: null } }, "__proto__");
  assert.deepEqual(dryTickCounts(tick(3, 0), "toString"), { mine: { due: 0, heldByHours: 0, at: null } }, "toString");
  for (const bad of ["2", -1, Number.NaN, null])
    assert.deepEqual(
      dryTickCounts(tickOf({ [A]: { due: 1, heldByHours: bad as number } }), A),
      { mine: { due: 1, heldByHours: 0, at: null } },
      String(bad),
    );
});

// ── 2. Rendered, every locale ────────────────────────────────────────
function render(locale: string, t: DispatchTick, outsideNow: boolean, id: string = A) {
  function Harness() {
    const tr = useTranslations("DashboardCampaigns.live");
    return createElement(DispatcherHealthBlock, {
      health: dispatchWording("dry", t, false, outsideNow, id).health,
      tick: t,
      ago: (iso: string) => (iso === AT ? "AGO" : iso === START_AT ? "AGO_START" : "AGO_OTHER"),
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
    assert.ok(!/[1-9]/.test(out), `${l}: no count in ${out}`);
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

test("two campaigns: A shows only its own numbers, B '0 (outside call hours)'", () => {
  const both = tickOf({ [A]: { due: 3, heldByHours: 0 }, [B]: { due: 0, heldByHours: 2 } });
  for (const l of LOCALES) {
    const a = render(l, both, false, A);
    assert.equal(a, fmt(l, "dryTickCount", { ago: "AGO", n: 3 }), `${l} A`);
    assert.ok(!a.includes(fmt(l, "dryTickWaitingCallHours", { m: 2 })), `${l} A never shows B's held contacts`);
    assert.ok(!a.includes("40") && !a.includes("20"), `${l} A never shows the global totals`);
    assert.equal(render(l, both, true, B), fmt(l, "dryTickOutsideCallHours", { ago: "AGO" }), `${l} B`);
  }
  assert.equal(render("fr", both, false, A), "Mode test : composeur passé AGO, 3 appels auraient été passés.");
});

test("a restarted campaign speaks of its own start; the other keeps the cron's numbers and time", () => {
  const restarted = tickOf({ [A]: { due: 3, heldByHours: 0, at: START_AT }, [B]: { due: 0, heldByHours: 2 } });
  for (const l of LOCALES) {
    assert.equal(render(l, restarted, false, A), fmt(l, "dryTickCount", { ago: "AGO_START", n: 3 }), `${l} A`);
    assert.equal(render(l, restarted, true, B), fmt(l, "dryTickOutsideCallHours", { ago: "AGO" }), `${l} B`);
  }
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
  assert.match(
    src,
    /dispatchWording\(mode, tick, tickStale, dispatcher\.blockers\.includes\("outside_call_window"\), campaign\.id\)/,
  );
  // the chips are drawn from the same array
  assert.match(src, /dispatcher\.blockers\.map\(\(b\) =>/);
});

if (failures) {
  console.error(`\n${failures} CAMPAIGNS-DRY-LINE TEST(S) FAILED`);
  process.exit(1);
}
console.log("ALL CAMPAIGNS-DRY-LINE TESTS PASSED");
