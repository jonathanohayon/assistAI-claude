// F1: the Centre d'appels screen tells the truth about test ("dry") mode.
//   - one pure wording table (dispatchWording) for the launch panel and the console;
//   - the "this call is real" line next to the instant test call, in every mode;
//   - dry is said BEFORE any click, seeded from the campaigns list GET;
//   - the red "never ran" alarm only when no tick exists; a dry tick reads neutral;
//   - an unknown mode keeps today's wording.
// Renders the REAL launch panel and health block to static HTML. Mock data only.
// Run with:  npx tsx scripts/tests/campaigns-dry-truth.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { IntlMessageFormat } from "intl-messageformat";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  dispatchWording,
  dryTickCounts,
  parseDispatchMode,
  type DispatcherHealth,
} from "../../lib/campaigns/live-view";
import type { DispatchTick } from "../../lib/campaigns/live";
import { CampaignLaunch } from "../../app/[locale]/dashboard/campaigns/campaign-launch";
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

function inProvider(locale: string, el: ReactElement) {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps, el),
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#x27;|&#39;/g, "'");

const AT = "2026-11-23T10:00:00.000Z";
const realTick: DispatchTick = { at: AT, source: "cron", claimed: 1, dialed: 1, failed: 0, runningCampaigns: 1 };
// The agreed contract: in dry the tick is written every time with mode "dry" plus would-dial counts.
const dryTick = {
  ...realTick, claimed: 0, dialed: 0, mode: "dry",
  wouldDial: { campaignsDue: 1, contactsDue: 3, skippedCallHours: 0, skippedConcurrency: 0 },
} as DispatchTick;
const dryTickNoCounts = { ...realTick, claimed: 0, dialed: 0, mode: "dry" } as DispatchTick;

// ── 1. The table ─────────────────────────────────────────────────────
test("dispatchWording: the table (mode × tick)", () => {
  type Row = [mode: unknown, tick: DispatchTick | null, stale: boolean, heading: string, line: string | null, health: DispatcherHealth];
  const TABLE: Row[] = [
    // unknown mode = today's wording, health as today
    [null, null, false, "launchTitle", null, { kind: "neverRan" }],
    [undefined, realTick, false, "launchTitle", null, { kind: "lastTick" }],
    ["bogus", realTick, true, "launchTitle", null, { kind: "stale" }],
    // on: today's behaviour
    ["on", null, false, "launchTitle", null, { kind: "neverRan" }],
    ["on", realTick, false, "launchTitle", null, { kind: "lastTick" }],
    ["on", realTick, true, "launchTitle", null, { kind: "stale" }],
    // off: calls switched off, no alarm
    ["off", null, false, "launchPausedTitle", "launchOffLine", { kind: "hidden" }],
    ["off", realTick, true, "launchPausedTitle", "launchOffLine", { kind: "hidden" }],
    // dry: simulation said up front; neutral line for a dry tick, alarm only with no tick
    ["dry", null, false, "launchDryTitle", "launchDryLine", { kind: "neverRan" }],
    ["dry", dryTick, false, "launchDryTitle", "launchDryLine", { kind: "dryTick", line: "count", contactsDue: 3, waitingCallHours: 0 }],
    ["dry", dryTickNoCounts, false, "launchDryTitle", "launchDryLine", { kind: "dryTick", line: "plain" }],
    ["dry", dryTick, true, "launchDryTitle", "launchDryLine", { kind: "stale" }],
    ["dry", realTick, false, "launchDryTitle", "launchDryLine", { kind: "lastTick" }],
  ];
  for (const [mode, tick, stale, heading, line, health] of TABLE) {
    const w = dispatchWording(mode, tick, stale);
    const label = `${String(mode)} / ${tick ? ((tick as { mode?: string }).mode ?? "real") : "no tick"} / stale=${stale}`;
    assert.equal(w.heading.key, heading, `heading ${label}`);
    assert.equal(w.heading.tone, heading === "launchTitle" ? "good" : "warn", `tone ${label}`);
    assert.equal(w.launchLine, line, `line ${label}`);
    assert.deepEqual(w.health, health, `health ${label}`);
  }
});

test("dry tick reader: mode word required, counts nested or flat, never invented", () => {
  assert.equal(dryTickCounts(realTick), null, "a real tick is not a dry one");
  assert.equal(dryTickCounts(null), null);
  assert.deepEqual(dryTickCounts(dryTick), { contactsDue: 3, skippedCallHours: 0 });
  assert.deepEqual(dryTickCounts({ ...realTick, mode: "dry", contactsDue: 2 }), { contactsDue: 2, skippedCallHours: 0 });
  assert.deepEqual(dryTickCounts(dryTickNoCounts), { contactsDue: null, skippedCallHours: 0 });
  assert.deepEqual(dryTickCounts({ ...realTick, mode: "dry", wouldDial: { contactsDue: "3" } }), { contactsDue: null, skippedCallHours: 0 });
  assert.deepEqual(dryTickCounts({ ...realTick, mode: "dry", wouldDial: { contactsDue: -1 } }), { contactsDue: null, skippedCallHours: 0 });
});

test("parseDispatchMode: unknown is null, never 'on'", () => {
  assert.equal(parseDispatchMode("dry"), "dry");
  assert.equal(parseDispatchMode("off"), "off");
  assert.equal(parseDispatchMode("on"), "on");
  for (const v of [undefined, null, "", "ON", "true", 1, {}]) assert.equal(parseDispatchMode(v), null, String(v));
});

// ── 2. Launch panel, rendered ────────────────────────────────────────
const launch = (locale: string, dispatchMode: unknown) =>
  text(inProvider(locale, createElement(CampaignLaunch, {
    campaignId: "00000000-0000-4000-8000-0000000000c1",
    status: "draft",
    stats: { total: 3, queued: 3, inFlight: 0, done: 0, connected: 0 } as never,
    dispatchMode: dispatchMode as never,
    onChanged: () => {},
  })));

test("the 'real call' line sits next to the instant test call in every mode and locale", () => {
  for (const l of LOCALES) {
    const dc = messages(l).DashboardCampaigns;
    for (const m of ["off", "dry", "on", null, undefined]) {
      const out = launch(l, m);
      assert.ok(out.includes(dc.testCallReal), `${l} ${String(m)}: real line`);
      assert.ok(out.indexOf(dc.testCallCta) < out.indexOf(dc.testCallReal), `${l} ${String(m)}: right after the button`);
    }
  }
  const src = read("app/[locale]/dashboard/campaigns/campaign-launch.tsx");
  assert.match(src, /aria-describedby="campaign-test-call-real"/, "the button is described by the line");
  assert.match(src, /id="campaign-test-call-real"/);
  assert.equal(messages("fr").DashboardCampaigns.testCallReal, "Cet appel est réel : le numéro sonnera.");
});

test("dry before any click: simulation heading + 'no number dialled', the start button keeps its label", () => {
  for (const l of LOCALES) {
    const dc = messages(l).DashboardCampaigns;
    const out = launch(l, "dry");
    assert.ok(out.includes(dc.launchDryTitle), `${l} heading`);
    assert.ok(out.includes(dc.launchDryLine), `${l} line`);
    assert.ok(out.includes(dc.startCta), `${l} start label kept`);
    assert.ok(!out.includes(dc.launchTitle), `${l} never 'ready'`);
  }
  assert.equal(messages("fr").DashboardCampaigns.launchDryTitle, "Mode test : simulation");
  assert.equal(messages("fr").DashboardCampaigns.launchDryLine, "Aucun numéro ne sera appelé.");
});

test("off before any click: calls paused, nothing dialled", () => {
  for (const l of LOCALES) {
    const dc = messages(l).DashboardCampaigns;
    const out = launch(l, "off");
    assert.ok(out.includes(dc.launchPausedTitle) && out.includes(dc.launchOffLine), l);
  }
});

test("unknown mode = today's text (no dry, no off line)", () => {
  for (const l of LOCALES) {
    const dc = messages(l).DashboardCampaigns;
    for (const m of [null, undefined]) {
      const out = launch(l, m);
      assert.ok(out.includes(dc.launchTitle), `${l} ${String(m)} today's heading`);
      for (const k of ["launchDryTitle", "launchDryLine", "launchOffLine", "launchPausedTitle"])
        assert.ok(!out.includes(dc[k]), `${l} ${String(m)} no ${k}`);
    }
  }
});

test("the workspace seeds the mode from the campaigns GET, optionally", () => {
  const ws = read("app/[locale]/dashboard/campaigns/campaigns-workspace.tsx");
  // both list loaders read it
  const seeds = ws.match(/setList\(data\.campaigns \?\? \[\]\);\s*seedDispatchMode\(data\.dispatchMode\);/g) ?? [];
  assert.equal(seeds.length, 2, "open + reload both seed");
  // missing / unknown keeps what we have (never forced to "on")
  assert.match(ws, /const m = parseDispatchMode\(raw\);\s*if \(m\) setDispatchMode\(m\);/);
  assert.match(ws, /<CampaignLaunch[\s\S]*?dispatchMode=\{dispatchMode\}/);
});

// ── 3. Console health block, rendered ────────────────────────────────
function health(locale: string, mode: unknown, tick: DispatchTick | null, stale = false) {
  function Harness() {
    const t = useTranslations("DashboardCampaigns.live");
    return createElement(DispatcherHealthBlock, {
      health: dispatchWording(mode, tick, stale).health,
      tick,
      ago: () => "AGO",
      t,
    });
  }
  return inProvider(locale, createElement(Harness));
}

test("no alarm for a dry tick: a neutral line with the would-dial count", () => {
  for (const l of LOCALES) {
    const live = messages(l).DashboardCampaigns.live;
    const html = health(l, "dry", dryTick);
    assert.ok(!html.includes('role="alert"'), `${l} no alarm`);
    assert.ok(!text(html).includes(live.neverRanTitle), `${l} no never-ran`);
    const want = new IntlMessageFormat(live.dryTickCount, l).format({ ago: "AGO", n: 3 }) as string;
    assert.ok(text(html).includes(want), `${l}: ${want}`);
    // without counts: the neutral line, no number invented
    const plain = text(health(l, "dry", dryTickNoCounts));
    assert.ok(plain.includes(new IntlMessageFormat(live.dryTick, l).format({ ago: "AGO" }) as string), `${l} no counts`);
  }
  assert.equal(
    new IntlMessageFormat(messages("fr").DashboardCampaigns.live.dryTickCount, "fr").format({ ago: "il y a 1 min", n: 3 }),
    "Mode test : composeur passé il y a 1 min, 3 appels auraient été passés.",
  );
  assert.equal(
    new IntlMessageFormat(messages("fr").DashboardCampaigns.live.dryTickCount, "fr").format({ ago: "il y a 1 min", n: 1 }),
    "Mode test : composeur passé il y a 1 min, 1 appel aurait été passé.",
  );
});

test("the red alarm shows for no tick at all (on, dry, unknown), never when off", () => {
  for (const l of LOCALES) {
    const live = messages(l).DashboardCampaigns.live;
    for (const m of ["on", "dry", null]) {
      const html = health(l, m, null);
      assert.ok(html.includes('role="alert"') && text(html).includes(live.neverRanTitle), `${l} ${String(m)}`);
    }
    assert.equal(health(l, "off", null), "", `${l} off: nothing`);
  }
});

test("a real tick keeps today's line; unknown mode keeps today's text", () => {
  const live = messages("fr").DashboardCampaigns.live;
  for (const m of ["on", null, undefined]) {
    const out = text(health("fr", m, realTick));
    assert.ok(out.includes("Composeur passé AGO"), String(m));
    assert.ok(!out.includes("Mode test"), String(m));
  }
  assert.ok(text(health("fr", "on", realTick, true)).includes(new IntlMessageFormat(live.staleTitle, "fr").format({ ago: "AGO" }) as string));
});

test("copy: every new key in fr/en/he, formats, no env or supplier name", () => {
  for (const l of LOCALES) {
    const dc = messages(l).DashboardCampaigns;
    for (const k of ["launchDryTitle", "launchDryLine", "launchOffLine", "testCallReal"])
      assert.ok(typeof dc[k] === "string" && new IntlMessageFormat(dc[k], l).format(), `${l} ${k}`);
    assert.ok(new IntlMessageFormat(dc.live.dryTick, l).format({ ago: "x" }), `${l} dryTick`);
    for (const n of [0, 1, 2, 7]) {
      const out = new IntlMessageFormat(dc.live.dryTickCount, l).format({ ago: "x", n }) as string;
      assert.ok(out && !out.includes("{"), `${l} dryTickCount ${n}`);
    }
    assert.doesNotMatch(
      JSON.stringify([dc.launchDryTitle, dc.launchDryLine, dc.launchOffLine, dc.testCallReal, dc.live.dryTick, dc.live.dryTickCount]),
      /CAMPAIGN_DISPATCH|twilio|livekit|dry/i,
      l,
    );
  }
});

if (failures) {
  console.error(`\n${failures} CAMPAIGNS-DRY-TRUTH TEST(S) FAILED`);
  process.exit(1);
}
console.log("ALL CAMPAIGNS-DRY-TRUTH TESTS PASSED");
