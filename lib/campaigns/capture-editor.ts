// Campaign "fields to capture" editor rules (client-safe, pure, no I/O).
// Unit-tested in scripts/tests/campaign-capture-gate.test.ts.
//
//   - Visibility follows the server's CAMPAIGN_CAPTURE switch, which reaches
//     the page as ONE boolean (`captureOn`, computed in the server page from
//     lib/campaigns/capture-mode.ts; the env name and value never leave the
//     server). Off: tenants don't see the editor at all; admins see it with
//     one "not active yet" line (same reading as MissionBrick's admin line).
//   - At most MAX_CAPTURE_FIELDS fields can be ADDED. A schema already above
//     the cap is kept as is: nothing here truncates or rewrites it; only
//     adding is blocked, removing still works.
import type { ExtractionField } from "./constants";

export const MAX_CAPTURE_FIELDS = 20;

export type CaptureEditorView = "hidden" | "off_admin" | "on";

export function captureEditorView(captureOn: boolean, isAdmin: boolean): CaptureEditorView {
  if (captureOn) return "on";
  return isAdmin ? "off_admin" : "hidden";
}

export function canAddCaptureField(schema: readonly ExtractionField[]): boolean {
  return schema.length < MAX_CAPTURE_FIELDS;
}

/** Appends an empty field; at or above the cap, returns the SAME array (no change). */
export function addCaptureField(schema: ExtractionField[]): ExtractionField[] {
  if (!canAddCaptureField(schema)) return schema;
  return [...schema, { key: "", label: "", type: "string" }];
}

/** Removes field i; always allowed, whatever the count. */
export function removeCaptureField(schema: ExtractionField[], i: number): ExtractionField[] {
  return schema.filter((_, idx) => idx !== i);
}
