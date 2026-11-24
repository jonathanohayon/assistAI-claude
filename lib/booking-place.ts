// Where an appointment takes place, for the calendar routes (book,
// reschedule, availability, list-dates). Pure.
//
// The place is free text the agent took from the TENANT's own company sheet
// (`location`, string or null). There is NO weekday rule in code: a tenant's
// rules reach the agent through the sheet's "location rules".
//
// A request WITHOUT a `location` key (the worker before it sends one) is
// handled EXACTLY like `location: null`. Its `center` key, if any, is ignored:
// the weekday-to-centre rule of lib/schedule.ts belonged to the first
// customer only (account deleted), and applying it to every account named that
// customer's towns in calls, refusals and event titles. No route may import
// lib/schedule.ts any more (scripts/tests/calendar-no-schedule-import.test.ts).

export const LOCATION_MAX = 120;

/** The tenant's own place name, or none. */
export type Place = { kind: "location"; label: string | null };

export type PlaceResult = {
  place: Place;
  /** The body carried a legacy `center` key that was ignored (log only). */
  ignoredCenter: boolean;
};

export function isNewShape(body: Record<string, unknown>): boolean {
  return "location" in body;
}

export function locationLabel(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, LOCATION_MAX) : null;
}

/** The place of a request; both shapes resolve through here, no route keeps its own branch. */
export function resolvePlace(body: Record<string, unknown>): PlaceResult {
  return {
    place: { kind: "location", label: isNewShape(body) ? locationLabel(body.location) : null },
    ignoredCenter: !isNewShape(body) && "center" in body,
  };
}

/** Console trace of an ignored legacy `center` key: the route only, no value, no personal data. */
export function noteIgnoredCenter(route: string, r: PlaceResult): void {
  if (r.ignoredCenter) console.info(`[calendar] ${route}: legacy center key ignored (no weekday rule)`);
}

// ── Texts ───────────────────────────────────────────────────────────────

export function eventTitle(place: Place, name: string): string {
  return place.label ? `RDV ${place.label} — ${name}` : `RDV — ${name}`;
}

/** The line in the event description ('' = none). */
export function eventPlaceLine(place: Place): string {
  return place.label ? `Lieu : ${place.label}` : "";
}

/** " à X" in the spoken confirmation ('' = none). */
export function atPlace(place: Place): string {
  return place.label ? ` à ${place.label}` : "";
}

/** The client name in a title written by eventTitle (null = not ours). */
export function nameFromTitle(title: string): string | null {
  const m = title.match(/^RDV (?:.+? )?— (.+)$/);
  return m ? m[1] : null;
}
