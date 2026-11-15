// Extraction schema cap, add-only (lib/campaigns/extraction-cap.ts), through
// the routes' own body → stored helpers: planCreateExtractionSchema (POST)
// and planCappedCampaignPatch (PATCH).
// Run with:  npx tsx scripts/tests/campaign-extraction-cap.test.ts

import assert from "node:assert/strict";

import { EXTRACTION_SCHEMA_MAX_FIELDS } from "../../lib/campaigns/constants";
import { MAX_CAPTURE_FIELDS } from "../../lib/campaigns/capture-editor";
import { CAPTURE_MAX_FIELDS, captureFields } from "../../lib/campaigns/capture";
import { planCreateExtractionSchema } from "../../lib/campaigns/extraction-cap";
import { planCappedCampaignPatch } from "../../lib/campaigns/patch-plan";
import { normalizeExtractionSchema } from "../../lib/campaigns/validate";

const fields = (n: number, labelOf = (i: number) => `Mock field ${i}`) =>
  Array.from({ length: n }, (_, i) => ({ key: `mock_${i}`, label: labelOf(i), type: "string" }));
const refusal = { ok: false, status: 400, body: { error: "too_many_fields", field: "extractionSchema", max: 20 } };

const campaignWith = (schema: unknown, status = "draft") => ({
  status,
  goalPreset: "custom",
  objective: "Mock objective",
  successCriteria: "",
  agentId: null,
  extractionSchema: schema,
  concurrency: 2,
  fromNumber: "",
});
// The workspace sends the whole draft on every save.
const draftBody = (schema: unknown, extra: Record<string, unknown> = {}) => ({
  name: "Mock campaign",
  goalPreset: "custom",
  objective: "Mock objective",
  successCriteria: "",
  agentId: null,
  extractionSchema: schema,
  concurrency: 2,
  fromNumber: "",
  ...extra,
});

// One constant: the server cap, the editor's add cap and capture's limit.
assert.equal(EXTRACTION_SCHEMA_MAX_FIELDS, 20);
assert.equal(MAX_CAPTURE_FIELDS, EXTRACTION_SCHEMA_MAX_FIELDS);
assert.equal(CAPTURE_MAX_FIELDS, EXTRACTION_SCHEMA_MAX_FIELDS);

// Normalization no longer slices the count (it still sanitizes keys/types/options).
{
  const n = normalizeExtractionSchema([...fields(35), { key: "  " }, { key: "x", type: "bogus" }]);
  assert.equal(n.length, 36, "no silent slice");
  assert.deepEqual(n[35], { key: "x", label: "x", type: "string" });
}

// Create: a new list of 20 passes, 21 → 400 naming the field.
{
  const ok = planCreateExtractionSchema(fields(20));
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.schema.length, 20);
  assert.deepEqual(planCreateExtractionSchema(fields(21)), refusal);
  assert.deepEqual(planCreateExtractionSchema(undefined), { ok: true, schema: [] });
}

// PATCH, a campaign stored with 25 fields (from before the cap).
const stored25 = normalizeExtractionSchema(fields(25));
assert.equal(stored25.length, 25);
for (const status of ["draft", "paused"]) {
  const c = campaignWith(stored25, status);

  // (1) other fields pass
  {
    const p = planCappedCampaignPatch(c, draftBody(stored25, { objective: "Mock objective 2" }));
    assert.ok(p.ok, `${status}: other field passes`);
    assert.deepEqual(p.ok && Object.keys(p.changes), ["objective"]);
  }
  // (2) unchanged re-send of the over-cap 25 passes, schema not rewritten (stays 25)
  {
    const p = planCappedCampaignPatch(c, draftBody(JSON.parse(JSON.stringify(stored25))));
    assert.deepEqual(p, { ok: true, changes: {} });
  }
  // over-cap kept: edit one label within the 25 → passes, stored whole (25, not sliced)
  {
    const edited = fields(25, (i) => (i === 24 ? "Mock field renamed" : `Mock field ${i}`));
    const p = planCappedCampaignPatch(c, draftBody(edited));
    assert.ok(p.ok, `${status}: label edit within 25 passes`);
    const next = p.ok ? (p.changes.extractionSchema as Array<{ label: string }>) : [];
    assert.equal(next.length, 25);
    assert.equal(next[24].label, "Mock field renamed");
  }
  // shrink from 25 to 22 passes
  {
    const p = planCappedCampaignPatch(c, draftBody(fields(22)));
    assert.ok(p.ok, `${status}: shrink 25 → 22 passes`);
    assert.equal(p.ok && (p.changes.extractionSchema as unknown[]).length, 22);
  }
  // (3) growing past 20 (a 26th) → 400 naming the field
  assert.deepEqual(planCappedCampaignPatch(c, draftBody(fields(26))), refusal);
  // (4) a save that OMITS extractionSchema keeps the stored value
  {
    const body = draftBody(undefined, { objective: "Mock objective 3" });
    delete (body as Record<string, unknown>).extractionSchema;
    const p = planCappedCampaignPatch(c, body);
    assert.ok(p.ok);
    assert.ok(p.ok && !("extractionSchema" in p.changes), "stored schema untouched");
  }
}

// PATCH that sets the field for the first time: 21 → 400, 20 → passes.
{
  const c = campaignWith([]);
  assert.deepEqual(planCappedCampaignPatch(c, draftBody(fields(21))), refusal);
  const p = planCappedCampaignPatch(c, draftBody(fields(20)));
  assert.ok(p.ok);
  assert.equal(p.ok && (p.changes.extractionSchema as unknown[]).length, 20);
  // A null stored column counts as empty.
  assert.deepEqual(planCappedCampaignPatch(campaignWith(null), draftBody(fields(21))), refusal);
}
// From 20 to 21: growing past the cap → 400.
assert.deepEqual(planCappedCampaignPatch(campaignWith(fields(20)), draftBody(fields(21))), refusal);

// The status rules still come first: a running campaign with a changed schema → 409.
{
  const p = planCappedCampaignPatch(campaignWith(stored25, "running"), draftBody(fields(26)));
  assert.equal(p.ok, false);
  assert.equal(!p.ok && "error" in p && p.error, "pause_to_edit");
}

// Capture with a stored 25: still the first 20.
{
  const used = captureFields(stored25);
  assert.equal(used.length, 20);
  assert.deepEqual(used.map((f) => f.key), stored25.slice(0, 20).map((f) => f.key));
}

console.log("campaign-extraction-cap: ok");
