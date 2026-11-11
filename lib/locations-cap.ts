// Location caps per plan (pure). A tenant's locations = `business.centres`
// on its agent config (mirrored as `companySheet.locations`).
//
// Rule (tamaraVP, 11/11): the cap blocks ADDING a location only. A save is
// refused only when the new count is above the cap AND above the stored
// count. An account already over its cap keeps every location and can still
// edit and delete them. Automatic writers (website scan) never remove a
// location: they may only add, within the room left under the cap.

import { sanitizeBusinessConfig, type BusinessConfig } from "@/lib/business";
import { currentCompanySheet, planSheetWrite, type SheetWrite } from "@/lib/knowledge/store";
import { PLANS, type PlanKey } from "@/lib/plans";

/** The ONE place the caps live: a change is a one-line diff. */
export const LOCATION_CAPS: Readonly<Record<PlanKey, number>> = { whatsapp: 1, global: 1, premium: 3 };

/**
 * The cap of an account's plan (`users.subscription_plan`). An unknown plan
 * (e.g. the legacy column default "essential") gets the cap of PLANS[0], the
 * same fallback the session config uses for the plan prefix.
 */
export function locationCapFor(plan: string | null | undefined): number {
  const key = PLANS.some((p) => p.key === plan) ? (plan as PlanKey) : PLANS[0].key;
  return LOCATION_CAPS[key];
}

export interface LocationCapRefusal {
  error: "location_cap";
  field: "centres";
  cap: number;
  message: string;
}

/** Server/dev string only: the screen builds its own sentence from `error` + `cap`. */
export function locationCapMessage(cap: number): string {
  return `Your plan includes ${cap} location${cap === 1 ? "" : "s"}.`;
}

export type LocationCountCheck = { ok: true } | { ok: false; status: 403; body: LocationCapRefusal };

/** Refused only when growing: next > cap AND next > stored. */
export function checkLocationCount(next: number, stored: number, cap: number): LocationCountCheck {
  if (next > cap && next > stored) {
    return { ok: false, status: 403, body: { error: "location_cap", field: "centres", cap, message: locationCapMessage(cap) } };
  }
  return { ok: true };
}

/** The same name matching the scan's proposal uses (case/space-insensitive). */
export const locationKey = (s: string) => s.trim().toLocaleLowerCase().replace(/\s+/g, " ");

/** How many new locations a scan may still add. */
export function locationRoom(existingCount: number, cap: number): number {
  return Math.max(0, cap - existingCount);
}

/**
 * Scanned locations against the existing ones: those matching an existing
 * location by name are updates (always kept); NEW ones are kept in order
 * only while there is room under the cap. Existing locations are never
 * touched here.
 */
export function capScannedLocations<T extends { name: string }>(
  existing: ReadonlyArray<{ name: string }>,
  scanned: ReadonlyArray<T>,
  cap: number,
): { kept: T[]; dropped: T[]; truncated: boolean } {
  const known = new Set(existing.map((l) => locationKey(l.name)));
  let room = locationRoom(existing.length, cap);
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const l of scanned) {
    if (known.has(locationKey(l.name))) kept.push(l);
    else if (room > 0) {
      kept.push(l);
      room--;
    } else dropped.push(l);
  }
  return { kept, dropped, truncated: dropped.length > 0 };
}

/**
 * The centres part of a legacy `business` write (PUT /api/dashboard/config):
 * the RAW parsed body → what is sanitized and stored. A `business` object
 * without a `centres` key keeps the stored centres (absent ≠ empty).
 */
export function businessWithStoredCentres(rawBusiness: unknown, storedCentres: unknown[]): unknown {
  if (!rawBusiness || typeof rawBusiness !== "object" || Array.isArray(rawBusiness)) return rawBusiness;
  if (Object.prototype.hasOwnProperty.call(rawBusiness, "centres")) return rawBusiness;
  return { ...(rawBusiness as Record<string, unknown>), centres: storedCentres };
}

// ── The two write paths, body → stored (used by the route handlers) ─────

/**
 * PUT /api/dashboard/config `business`: the stored row + the raw `business`
 * of the body → the sanitized business to store, or the 403. `plan` is the
 * plan of the account whose row is written.
 */
export function planConfigBusinessWrite(
  rawBusiness: unknown,
  storedBusiness: unknown,
  plan: string | null | undefined,
): { ok: true; business: BusinessConfig } | { ok: false; status: 403; body: LocationCapRefusal } {
  const stored = sanitizeBusinessConfig(storedBusiness);
  const business = sanitizeBusinessConfig(businessWithStoredCentres(rawBusiness, stored.centres));
  const check = checkLocationCount(business.centres.length, stored.centres.length, locationCapFor(plan));
  return check.ok ? { ok: true, business } : check;
}

/**
 * PUT /api/dashboard/company-sheet: the account row (sheet, business, plan)
 * + the body's `companySheet` patch → the sheet write, the 400 of the sheet
 * contract, or the 403. Under ?asUserId= the row is the TENANT's, so the cap
 * is the tenant's plan, whoever edits.
 */
export function planCappedSheetWrite(
  row: { companySheet: unknown; business: unknown; plan: string | null | undefined },
  patch: unknown,
): SheetWrite | { ok: false; status: 403; body: LocationCapRefusal } {
  const write = planSheetWrite(currentCompanySheet(row.companySheet, row.business), patch);
  if (!write.ok) return write;
  const stored = sanitizeBusinessConfig(row.business).centres.length;
  const check = checkLocationCount(write.business.centres.length, stored, locationCapFor(row.plan));
  return check.ok ? write : check;
}

/**
 * The scan's `result` event + `locationCap`, `centresTruncated` and
 * `centresDropped` (how many NEW locations do not fit), against
 * the stored centres. The draft itself is unchanged (it writes nothing): the
 * proposal (planScan) applies the cap when it merges.
 */
export function scanResultWithCap(
  ev: Record<string, unknown>,
  storedCentres: ReadonlyArray<{ name: string }>,
  plan: string | null | undefined,
): Record<string, unknown> {
  const cap = locationCapFor(plan);
  const business = ev.business as { centres?: Array<{ name: string }> } | undefined;
  const { truncated, dropped } = capScannedLocations(storedCentres, business?.centres ?? [], cap);
  return { ...ev, locationCap: cap, centresTruncated: truncated, centresDropped: dropped.length };
}
