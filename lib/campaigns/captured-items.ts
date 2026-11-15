// "Captured from the conversation" block of a campaign call (results modal).
// CLIENT-SAFE and pure. Unit-tested in scripts/tests/campaign-results-captured.test.ts.
//
// Rules:
//   - Nothing at all (null) when capture is off: the page's `captureOn` is
//     false, or the call has no recorded capture attempt (`captured` absent or
//     null: switch off server-side, not attempted yet, or a pending claim).
//   - Otherwise one item per field of the campaign's CURRENT schema, in the
//     schema's order, under its CURRENT label (a label edited after the call
//     shows its new text). A field with no captured value is an item with
//     value null, which the UI names as missing (never hidden).
//   - A captured key that is no longer in the schema is omitted: the stored
//     payload (lib/campaigns/capture.ts CapturePayload) keeps values by key
//     only, with no label, and the technical key is never shown.
import type { CapturedView } from "@/lib/campaigns/capture";
import type { ExtractionField } from "@/lib/campaigns/constants";

export type CapturedValue = string | number | boolean;

export interface CapturedItem {
  key: string;
  label: string;
  /** null = not captured in this call. */
  value: CapturedValue | null;
}

export function capturedItems(
  schema: readonly ExtractionField[] | null | undefined,
  captured: CapturedView | undefined,
  captureOn: boolean,
): CapturedItem[] | null {
  if (!captureOn || !captured || !Array.isArray(schema)) return null;
  const values =
    captured.values && typeof captured.values === "object" && !Array.isArray(captured.values)
      ? captured.values
      : {};
  const seen = new Set<string>();
  const items: CapturedItem[] = [];
  for (const f of schema) {
    if (!f || typeof f.key !== "string" || !f.key || seen.has(f.key)) continue;
    seen.add(f.key);
    const label = typeof f.label === "string" ? f.label.trim() : "";
    if (!label) continue;
    const v = Object.prototype.hasOwnProperty.call(values, f.key) ? values[f.key] : null;
    const value =
      typeof v === "string" ? (v.trim() ? v : null)
      : typeof v === "number" ? (Number.isFinite(v) ? v : null)
      : typeof v === "boolean" ? v
      : null;
    items.push({ key: f.key, label, value });
  }
  return items.length ? items : null;
}

export interface CapturedCount {
  /** Schema items with a captured value. */
  got: number;
  /** Items in the campaign's current schema (same set as the expanded block). */
  total: number;
}

/**
 * Count for the collapsed-row chip ("3/4 captured"). Derived from
 * capturedItems() so it can never disagree with the expanded block: same
 * items, same visibility (null whenever the block renders nothing). 0/N is
 * a real answer (the capture ran and found nothing) and is returned.
 */
export function capturedCount(
  schema: readonly ExtractionField[] | null | undefined,
  captured: CapturedView | undefined,
  captureOn: boolean,
): CapturedCount | null {
  const items = capturedItems(schema, captured, captureOn);
  if (!items) return null;
  return { got: items.filter((i) => i.value !== null).length, total: items.length };
}
