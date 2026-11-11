// Campaign console: a start / resume / pause never looks like it worked silently.
// Mock data only. Run with:  npx tsx scripts/tests/campaign-start-feedback.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { IntlMessageFormat } from "intl-messageformat";

import {
  actionErrorKey,
  dispatchNoticeKey,
  launchHeading,
  MODE_VIEW,
  modeView,
  readyPill,
  showDispatcherAlert,
} from "../../lib/campaigns/live-view";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// 1. A refused action in plain words: server code first, HTTP status as fallback, generic otherwise
{
  assert.equal(actionErrorKey(403, { error: "Forbidden" }), "forbidden");
  assert.equal(actionErrorKey(409, { error: "invalid_transition", from: "completed", action: "pause" }), "changed");
  assert.equal(actionErrorKey(500, null), "unknown", "500 with no body");
  assert.equal(actionErrorKey(500, { error: "boom: supplier text" }), "unknown", "never echoes a raw error");
  assert.equal(actionErrorKey(404, { error: "not_found" }), "notFound");
  assert.equal(actionErrorKey(401, { error: "Unauthorized" }), "session");
  assert.equal(actionErrorKey(null, null), "unknown", "network failure");
  assert.equal(actionErrorKey(400, { error: "invalid_action" }), "unknown");
  assert.equal(actionErrorKey(403, null), "forbidden", "status alone");
}

// 2. The platform call switch: off / dry say so, on says nothing
{
  assert.equal(dispatchNoticeKey("off"), "dispatchOff");
  assert.equal(dispatchNoticeKey("dry"), "dispatchDry");
  assert.equal(dispatchNoticeKey("on"), null);
  assert.equal(dispatchNoticeKey(undefined), null);
}

// 3. Wiring: every non-OK answer (and a thrown fetch) sets the error; the notice reads the snapshot first, then the start's answer
{
  const src = read("app/[locale]/dashboard/campaigns/campaign-live-console.tsx");
  assert.match(src, /\} else \{\s*setActionError\(\{ action, key: actionErrorKey\(res\.status, body\) \}\);/);
  assert.match(src, /\} catch \{\s*setActionError\(\{ action, key: actionErrorKey\(null, null\) \}\);/);
  assert.match(src, /role="alert"[^>]*>\s*\{t\(`actionError\.\$\{actionError\.key\}`, \{ action: actionError\.action \}\)\}/);
  assert.match(src, /const mode = dispatcher\.dispatchMode \?\? postedMode;/, "survives a reload via /live");
  assert.match(src, /running \? dispatchNoticeKey\(mode\) : null/);
  assert.match(src, /if \(body\.dispatchMode\) setPostedMode\(body\.dispatchMode\)/, "shown right after the start");
}

// 4. Copy: same keys in fr/en/he, every message formats for both actions, no supplier or env name
{
  for (const l of ["fr", "en", "he"]) {
    const live = JSON.parse(read(`messages/${l}.json`)).DashboardCampaigns.live;
    for (const k of ["dispatchOff", "dispatchDry"]) assert.ok(new IntlMessageFormat(live[k], l).format(), `${l} ${k}`);
    for (const k of ["session", "forbidden", "notFound", "changed", "unknown"])
      for (const action of ["start", "pause"]) {
        const out = new IntlMessageFormat(live.actionError[k], l).format({ action }) as string;
        assert.ok(out && !out.includes("{"), `${l} ${k} ${action}`);
      }
    assert.doesNotMatch(JSON.stringify([live.dispatchOff, live.dispatchDry, live.actionError]), /CAMPAIGN_DISPATCH|twilio|livekit/i, l);
  }
  const fr = JSON.parse(read("messages/fr.json")).DashboardCampaigns.live.actionError;
  assert.notEqual(new IntlMessageFormat(fr.unknown, "fr").format({ action: "pause" }), new IntlMessageFormat(fr.unknown, "fr").format({ action: "start" }));
}

// 5. While calls are off the screen never contradicts the line: amber pill, no dispatcher alarm
{
  // off: amber "paused" pill, both dispatcher alerts (never ran / stale) hidden
  assert.deepEqual(readyPill("off", []), { key: "dispatchPausedPill", tone: "warn" });
  assert.equal(showDispatcherAlert("off"), false);
  // dry: amber "test mode" pill; the dispatcher does run, so its alerts stay
  assert.deepEqual(readyPill("dry", []), { key: "dispatchDryPill", tone: "warn" });
  assert.equal(showDispatcherAlert("dry"), true);
  // on (and a snapshot without the field): today's green pill and alerts
  assert.deepEqual(readyPill("on", []), { key: "readyToDial", tone: "good" });
  assert.deepEqual(readyPill(undefined, []), { key: "readyToDial", tone: "good" });
  assert.equal(showDispatcherAlert("on"), true);
  assert.equal(showDispatcherAlert(undefined), true);
  // blockers present: the blocker chips speak, whatever the mode
  for (const m of ["off", "dry", "on"]) assert.equal(readyPill(m, ["outside_call_window"]), null, m);

  const src = read("app/[locale]/dashboard/campaigns/campaign-live-console.tsx");
  assert.match(src, /const pill = readyPill\(mode, dispatcher\.blockers\);/);
  assert.match(src, /\{pill \? \(\s*<Chip tone=\{pill\.tone\}>\{t\(pill\.key\)\}<\/Chip>/);
  assert.match(src, /\{!showDispatcherAlert\(mode\) \? null : tick === null \? \(/, "gates both never-ran and stale alerts");
  assert.doesNotMatch(src, /<Chip tone="good">\{t\("readyToDial"\)\}/, "no hard-coded green pill left");

  for (const l of ["fr", "en", "he"]) {
    const live = JSON.parse(read(`messages/${l}.json`)).DashboardCampaigns.live;
    for (const k of ["dispatchPausedPill", "dispatchDryPill", "readyToDial"])
      assert.ok(typeof live[k] === "string" && new IntlMessageFormat(live[k], l).format(), `${l} ${k}`);
    assert.notEqual(live.dispatchPausedPill, live.dispatchDryPill, l);
  }
}

// 6. The launch panel above the console reads the SAME mode table as the pill: they can never disagree
{
  // three modes: "ready to launch" only when calls really go out
  assert.deepEqual(launchHeading("off"), { key: "launchPausedTitle", tone: "warn" });
  assert.deepEqual(launchHeading("dry"), { key: "launchDryTitle", tone: "warn" });
  assert.deepEqual(launchHeading("on"), { key: "launchTitle", tone: "good" });
  assert.deepEqual(launchHeading(null), launchHeading("on"), "not known yet: same fallback as the pill");

  // both read MODE_VIEW: same tone per mode, labels from the same row
  for (const m of ["off", "dry", "on", undefined, null] as const) {
    const row = modeView(m);
    const pill = readyPill(m, [])!;
    const head = launchHeading(m);
    assert.equal(pill.tone, head.tone, `tone ${m}`);
    assert.equal(pill.key, row.pill, `pill ${m}`);
    assert.equal(head.key, row.launch, `heading ${m}`);
  }
  assert.deepEqual(Object.keys(MODE_VIEW).sort(), ["dry", "off", "on"]);

  // wiring: the panel renders launchHeading with the shared amber chip, never a hard-coded title
  const launch = read("app/[locale]/dashboard/campaigns/campaign-launch.tsx");
  assert.match(launch, /const heading = launchHeading\(dispatchMode\);/);
  assert.match(launch, /heading\.tone === "warn"[\s\S]*?TONE_CHIP\.warn[\s\S]*?\{t\(heading\.key\)\}/);
  assert.doesNotMatch(launch, /t\("launchTitle"\)/, "no hard-coded ready title left");
  assert.match(launch, /if \(data\.dispatchMode\) onDispatchMode\?\.\(data\.dispatchMode\)/, "a start's answer updates it");
  // the console hands its mode up; the workspace feeds it to the panel
  const consoleSrc = read("app/[locale]/dashboard/campaigns/campaign-live-console.tsx");
  assert.match(consoleSrc, /const seenMode = snap\?\.dispatcher\.dispatchMode \?\? postedMode;/);
  assert.match(consoleSrc, /if \(seenMode\) onDispatchMode\?\.\(seenMode\)/);
  assert.match(consoleSrc, /TONE_CHIP\[tone\]/, "console chips use the shared tones");
  const ws = read("app/[locale]/dashboard/campaigns/campaigns-workspace.tsx");
  assert.match(ws, /<CampaignLaunch[\s\S]*?dispatchMode=\{dispatchMode\}[\s\S]*?onDispatchMode=\{setDispatchMode\}/);
  assert.match(ws, /<CampaignLiveConsole[\s\S]*?onDispatchMode=\{setDispatchMode\}/);

  // copy: every launch key in fr/en/he, paused and test mode differ, no env/supplier name
  for (const l of ["fr", "en", "he"]) {
    const dc = JSON.parse(read(`messages/${l}.json`)).DashboardCampaigns;
    for (const k of Object.values(MODE_VIEW).map((r) => r.launch))
      assert.ok(typeof dc[k] === "string" && new IntlMessageFormat(dc[k], l).format(), `${l} ${k}`);
    assert.notEqual(dc.launchPausedTitle, dc.launchDryTitle, l);
    assert.notEqual(dc.launchPausedTitle, dc.launchTitle, l);
    assert.doesNotMatch(JSON.stringify([dc.launchPausedTitle, dc.launchDryTitle]), /CAMPAIGN_DISPATCH|twilio|livekit/i, l);
  }
  const fr = JSON.parse(read("messages/fr.json")).DashboardCampaigns;
  assert.equal(fr.launchDryTitle, "Mode test");
  // Design review: what is paused is the CALLS, not the campaign (the owner has their own Pause button).
  const paused = (l: string) => JSON.parse(read(`messages/${l}.json`)).DashboardCampaigns.launchPausedTitle as string;
  assert.match(paused("fr"), /^Appels en pause/);
  assert.match(paused("en"), /^Calls paused/);
  assert.match(paused("he"), /^השיחות מושהות/);
}

console.log("ALL CAMPAIGN-START-FEEDBACK TESTS PASSED");
