// Where an appointment takes place, for the calendar routes (book,
// reschedule, availability). Pure.
//
// TWO request shapes:
//   - NEW (the request carries a `location` key, string or null): the place
//     is free text the agent took from the TENANT's own company sheet. No
//     weekday rule: the tenant's rules reach the agent through the sheet's
//     "location rules", never through code.
//   - LEGACY (no `location` key, the worker before this change): today's
//     behaviour EXACTLY — lib/schedule.ts binds each weekday to one centre
//     (rules of the first customer), refuses a mismatch, labels events.
// Kept until the worker that sends `location` has shipped; then the legacy
// path and lib/schedule.ts can go.

import { type Center, validateBooking, type ValidationError } from "@/lib/schedule";

export const LOCATION_MAX = 120;

export type Place =
  /** Legacy: the weekday's centre (validated). */
  | { kind: "legacy"; center: Center; label: string }
  /** New: the tenant's own place name, or none. */
  | { kind: "location"; label: string | null };

export type PlaceResult =
  | { ok: true; place: Place }
  | { ok: false; kind: "wrong_center"; requested: Center; refusal: ValidationError }
  | { ok: false; kind: "invalid_date"; error: string };

export function isNewShape(body: Record<string, unknown>): boolean {
  return "location" in body;
}

export function locationLabel(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, LOCATION_MAX) : null;
}

export function resolvePlace(body: Record<string, unknown>, date: string): PlaceResult {
  if (isNewShape(body)) return { ok: true, place: { kind: "location", label: locationLabel(body.location) } };
  const requested = typeof body.center === "string" && body.center.trim() ? (body.center.trim() as Center) : null;
  try {
    const v = validateBooking(date, requested);
    if (!v.ok) return { ok: false, kind: "wrong_center", requested: requested as Center, refusal: v };
    return { ok: true, place: { kind: "legacy", center: v.center, label: v.label } };
  } catch (e) {
    return { ok: false, kind: "invalid_date", error: (e as Error).message };
  }
}

// ── Texts (legacy = byte-identical to before) ──────────────────────────

export function eventTitle(place: Place, name: string): string {
  return place.label ? `RDV ${place.label} — ${name}` : `RDV — ${name}`;
}

/** The line in the event description ('' = none). */
export function eventPlaceLine(place: Place): string {
  if (place.kind === "legacy") return `Centre : ${place.label}`;
  return place.label ? `Lieu : ${place.label}` : "";
}

/** " à X" in the spoken confirmation ('' = none). */
export function atPlace(place: Place): string {
  return place.label ? ` à ${place.label}` : "";
}

/**
 * The client name in a title written by eventTitle (null = not ours).
 * Legacy keeps its exact former pattern ("RDV <label> — <name>" only).
 */
export function nameFromTitle(title: string, place: Place): string | null {
  const m = title.match(place.kind === "legacy" ? /^RDV .+? — (.+)$/ : /^RDV (?:.+? )?— (.+)$/);
  return m ? m[1] : null;
}
