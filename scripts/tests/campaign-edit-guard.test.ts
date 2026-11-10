// Campaign editor save rules (lib/campaigns/edit-guard.ts).
// Run with:  npx tsx scripts/tests/campaign-edit-guard.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PAUSE_TO_EDIT_LABELS,
  isDraftDirty,
  pauseToEditFields,
  pauseToEditLabels,
  snapshot,
} from "../../lib/campaigns/edit-guard";

// 409 body parsing
assert.deepEqual(pauseToEditFields({ error: "pause_to_edit", fields: ["fromNumber", "agentId"] }), ["fromNumber", "agentId"]);
assert.deepEqual(pauseToEditFields({ error: "pause_to_edit" }), []);
assert.equal(pauseToEditFields({ error: "other" }), null);
assert.equal(pauseToEditFields(null), null);
assert.equal(pauseToEditFields("x"), null);

// labels: known fields translated, unknown kept raw
const t = (k: string) => `<${k}>`;
assert.equal(pauseToEditLabels(["fromNumber", "agentId"], t), "<fromNumberLabel>, <agentSelectLabel>");
assert.equal(pauseToEditLabels(["somethingNew"], t), "somethingNew");

// every label key exists in all three locales, and the message has {fields}
for (const l of ["en", "fr", "he"]) {
  const m = JSON.parse(readFileSync(new URL(`../../messages/${l}.json`, import.meta.url), "utf8")).DashboardCampaigns;
  for (const key of Object.values(PAUSE_TO_EDIT_LABELS)) {
    assert.ok(typeof m[key] === "string" && m[key].length > 0, `${l}: missing ${key}`);
  }
  assert.match(m.pauseToEdit, /\{fields\}/, `${l}: pauseToEdit needs {fields}`);
}

// dirty check: never saved → dirty; unchanged → clean; any field change → dirty
const d = { id: "c1", name: "Mock", callWindow: { startHour: 9, endHour: 18 } };
assert.equal(isDraftDirty(d, null), true);
assert.equal(isDraftDirty(d, snapshot(d)), false);
assert.equal(isDraftDirty({ ...d, callWindow: { startHour: 10, endHour: 18 } }, snapshot(d)), true);

console.log("ALL CAMPAIGN-EDIT-GUARD TESTS PASSED");
