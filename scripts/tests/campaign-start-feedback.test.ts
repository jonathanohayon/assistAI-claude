// Campaign console: a start / resume / pause never looks like it worked silently.
// Mock data only. Run with:  npx tsx scripts/tests/campaign-start-feedback.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { IntlMessageFormat } from "intl-messageformat";

import { actionErrorKey, dispatchNoticeKey } from "../../lib/campaigns/live-view";

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
  assert.match(src, /running \? dispatchNoticeKey\(dispatcher\.dispatchMode \?\? postedMode\) : null/, "survives a reload via /live");
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

console.log("ALL CAMPAIGN-START-FEEDBACK TESTS PASSED");
