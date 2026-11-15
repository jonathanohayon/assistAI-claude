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
//   - Tenants type a LABEL only; the technical key is derived and hidden
//     (editable in developer mode and for admins). A key the server already
//     stores is never re-derived: see setCaptureLabel below.
import { EXTRACTION_SCHEMA_MAX_FIELDS, type ExtractionField } from "./constants";

export const MAX_CAPTURE_FIELDS = EXTRACTION_SCHEMA_MAX_FIELDS;

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

/** Longest slug kept before any _N suffix (the server caps keys at 60). */
export const CAPTURE_KEY_SLUG_MAX = 40;

/** Latin letters NFKD does not decompose. */
const LATIN_EXTRA: Record<string, string> = { œ: "oe", æ: "ae", ß: "ss", ø: "o", ł: "l", đ: "d" };

/**
 * ASCII slug of a label: accents stripped, lowercase, [a-z0-9] runs joined by
 * "_", at most CAPTURE_KEY_SLUG_MAX chars. "" when nothing Latin is left
 * (e.g. a Hebrew label).
 */
export function slugifyCaptureKey(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[œæßøłđ]/g, (c) => LATIN_EXTRA[c] ?? "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, CAPTURE_KEY_SLUG_MAX)
    .replace(/_+$/, "");
}

/**
 * The key for the field at index `i` with this label, unique against `taken`
 * (the other fields' keys plus the stored ones). An empty label gives ""
 * (a blank row stays blank and the server drops it, as before). A label with
 * no Latin slug falls back to field_N (N from i + 1, next free number); a
 * slug that is taken gets _2, _3…
 */
export function deriveCaptureKey(label: string, i: number, taken: ReadonlySet<string>): string {
  if (!label.trim()) return "";
  const slug = slugifyCaptureKey(label);
  if (!slug) {
    let n = i + 1;
    while (taken.has(`field_${n}`)) n++;
    return `field_${n}`;
  }
  if (!taken.has(slug)) return slug;
  let n = 2;
  while (taken.has(`${slug}_${n}`)) n++;
  return `${slug}_${n}`;
}

/** Keys of the schema as last loaded or saved (the workspace's snapshot). */
export function storedCaptureKeys(savedSnapshot: string | null): string[] {
  if (!savedSnapshot) return [];
  try {
    const d = JSON.parse(savedSnapshot) as { extractionSchema?: unknown };
    if (!Array.isArray(d.extractionSchema)) return [];
    return d.extractionSchema
      .map((f) => (f && typeof f === "object" ? (f as { key?: unknown }).key : null))
      .filter((k): k is string => typeof k === "string" && k !== "");
  } catch {
    return [];
  }
}

function takenKeys(schema: readonly ExtractionField[], i: number, stored: readonly string[]): Set<string> {
  const taken = new Set(stored);
  schema.forEach((f, idx) => {
    if (idx !== i && f.key) taken.add(f.key);
  });
  return taken;
}

/**
 * Sets field i's label. Its key follows the label only while the key is not
 * stored AND is still the one derived from the previous label (or empty):
 * a stored key, or one typed by hand in developer mode, never changes here.
 * Derived keys are unique against the other fields AND the stored keys, so a
 * removed field's key is never reused for a new one.
 */
export function setCaptureLabel(
  schema: ExtractionField[],
  i: number,
  label: string,
  stored: readonly string[] = [],
): ExtractionField[] {
  const f = schema[i];
  if (!f) return schema;
  const taken = takenKeys(schema, i, stored);
  const follows =
    !stored.includes(f.key) && (f.key === "" || f.key === deriveCaptureKey(f.label, i, taken));
  const key = follows ? deriveCaptureKey(label, i, taken) : f.key;
  return schema.map((g, idx) => (idx === i ? { ...g, label, key } : g));
}

/** The schema as last loaded or saved (the workspace's snapshot): key + label. */
export function storedCaptureFields(savedSnapshot: string | null): { key: string; label: string }[] {
  if (!savedSnapshot) return [];
  try {
    const d = JSON.parse(savedSnapshot) as { extractionSchema?: unknown };
    if (!Array.isArray(d.extractionSchema)) return [];
    return d.extractionSchema.flatMap((f) => {
      if (!f || typeof f !== "object") return [];
      const { key, label } = f as { key?: unknown; label?: unknown };
      if (typeof key !== "string" || key === "") return [];
      return [{ key, label: typeof label === "string" ? label : "" }];
    });
  } catch {
    return [];
  }
}

/**
 * Rows that block the save: an empty (or blank) label. A new row the user
 * added and never typed in counts too. One exception, so an untouched schema
 * is never blocked: a row whose key is stored AND whose stored label is
 * empty too (it came from the server like that; the server falls back to the
 * key as the label, lib/campaigns/validate.ts). Clearing a stored row's
 * label still blocks.
 */
export function unlabeledCaptureRows(
  schema: readonly ExtractionField[],
  stored: readonly { key: string; label: string }[] = [],
): number[] {
  const storedEmpty = new Set(stored.filter((f) => !f.label.trim()).map((f) => f.key));
  const out: number[] = [];
  schema.forEach((f, i) => {
    if ((f.label ?? "").trim()) return;
    if (f.key && storedEmpty.has(f.key)) return;
    out.push(i);
  });
  return out;
}

/**
 * Developer-mode warning: the row's key as the editor last saw it stored
 * (`origin`) is a stored key, and the edited key differs from it. Values
 * already captured keep the old key.
 */
export function captureKeyRenamed(
  origin: string | null | undefined,
  current: string,
  stored: readonly string[],
): boolean {
  return !!origin && stored.includes(origin) && current !== origin;
}

/**
 * The server's 400 { error: "too_many_fields", field: "extractionSchema" }
 * (lib/campaigns/extraction-cap.ts) → true. The caller shows our own
 * sentence with MAX_CAPTURE_FIELDS, never the server's text.
 */
export function isTooManyCaptureFields(status: number, body: unknown): boolean {
  if (status !== 400 || !body || typeof body !== "object") return false;
  const b = body as { error?: unknown; field?: unknown };
  return b.error === "too_many_fields" && b.field === "extractionSchema";
}
