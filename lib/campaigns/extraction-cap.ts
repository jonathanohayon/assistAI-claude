// Extraction schema cap (pure, no I/O). Same add-only rule as the location
// caps (lib/locations-cap.ts):
//
//   - A NEW list (campaign create) above EXTRACTION_SCHEMA_MAX_FIELDS → 400.
//   - A PATCH is refused only when the new count is above the cap AND above
//     the stored count: a list stored above the cap (from before the cap) is
//     kept, can be edited and can shrink, but may not grow.
//   - Never a silent slice: what is accepted is stored whole.
//
// Unit-tested in scripts/tests/campaign-extraction-cap.test.ts.

import { EXTRACTION_SCHEMA_MAX_FIELDS, type ExtractionField } from "./constants";
import { normalizeExtractionSchema } from "./validate";

export interface ExtractionSchemaCapRefusal {
  error: "too_many_fields";
  field: "extractionSchema";
  max: number;
}

export type ExtractionCapCheck =
  | { ok: true }
  | { ok: false; status: 400; body: ExtractionSchemaCapRefusal };

/** Refused only when growing: next > cap AND next > stored. */
export function checkExtractionSchemaCount(next: number, stored: number): ExtractionCapCheck {
  if (next > EXTRACTION_SCHEMA_MAX_FIELDS && next > stored) {
    return {
      ok: false,
      status: 400,
      body: { error: "too_many_fields", field: "extractionSchema", max: EXTRACTION_SCHEMA_MAX_FIELDS },
    };
  }
  return { ok: true };
}

/**
 * POST /api/dashboard/campaigns: the raw body's `extractionSchema` → the
 * normalized schema to store, or the 400. A new campaign has nothing stored.
 */
export function planCreateExtractionSchema(
  raw: unknown,
): { ok: true; schema: ExtractionField[] } | { ok: false; status: 400; body: ExtractionSchemaCapRefusal } {
  const schema = normalizeExtractionSchema(raw);
  const check = checkExtractionSchemaCount(schema.length, 0);
  return check.ok ? { ok: true, schema } : check;
}
