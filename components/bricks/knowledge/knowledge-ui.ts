// Knowledge brick — pure helpers for the one "what the agent knows" screen.
// Tenant-safe (no supplier word): imported by tenant pages.
//
// The company sheet belongs to the ACCOUNT (shared by every agent) and is
// saved through GET/PUT /api/dashboard/company-sheet (#202): top-level keys
// REPLACE (whole arrays), `identity` merges key by key, the response is the
// normalized sheet to keep. The agent's instructions stay on the agent.

import type { BusinessConfig } from "@/lib/business";
import { sheetFromBusiness } from "@/lib/knowledge/adapters";
import type { CompanySheet } from "@/lib/knowledge/contract";

export { businessFromSheet, sheetFromBusiness } from "@/lib/knowledge/adapters";

type SheetKey = Exclude<keyof CompanySheet, "version">;
const SHEET_KEYS: SheetKey[] = ["identity", "locations", "services", "locationRules", "notes", "faq", "sources"];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The PUT body for what changed: each changed top-level key whole, and only
 * the changed identity fields. Empty object = nothing to save.
 */
export function sheetPatch(base: CompanySheet, next: CompanySheet): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of SHEET_KEYS) {
    if (k === "identity") {
      const id: Record<string, string> = {};
      for (const f of Object.keys(next.identity) as (keyof CompanySheet["identity"])[]) {
        if (next.identity[f] !== base.identity[f]) id[f] = next.identity[f];
      }
      if (Object.keys(id).length) out.identity = id;
    } else if (!same(base[k], next[k])) {
      out[k] = next[k];
    }
  }
  return out;
}

/** Same site, whatever the scheme, case of the host or trailing slash. */
export function sameSite(a: string, b: string): boolean {
  const norm = (u: string) =>
    u
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  return norm(a) === norm(b);
}

export const SOURCES_MAX = 20;

/** Record a learned site: refresh its date, or add it (newest first, capped). */
export function withSource(sources: CompanySheet["sources"], url: string, learnedAt: string): CompanySheet["sources"] {
  const clean = url.trim();
  if (!clean) return sources;
  const rest = sources.filter((s) => !sameSite(s.url, clean));
  return [{ url: clean, learnedAt }, ...rest].slice(0, SOURCES_MAX);
}

/**
 * The website-scan result (a business, as the review step built it) back
 * into the sheet: facts from the business, FAQ kept, the site recorded.
 */
export function applyScan(sheet: CompanySheet, business: BusinessConfig, url: string, learnedAt: string): CompanySheet {
  return { ...withFacts(sheet, business), sources: withSource(sheet.sources, url, learnedAt) };
}

/** An edit made in the business-shaped editors (locations, services) → the sheet; FAQ and sources kept. */
export function withFacts(sheet: CompanySheet, business: BusinessConfig): CompanySheet {
  return { ...sheetFromBusiness(business), faq: sheet.faq, sources: sheet.sources };
}

/** A server 400 field → a translatable message (key + params). */
export type SheetIssue =
  | { key: "duplicateLocation" | "duplicateService"; params: { id: string } }
  | { key: "unknownLocation"; params: { service: string; id: string } }
  | { key: "invalidEmail" | "notesTooLong" | "invalid"; params: Record<string, string> };

export function sheetIssues(fields: string[], sheet: CompanySheet): SheetIssue[] {
  return fields.map((f): SheetIssue => {
    let m = /^companySheet\.locations: duplicate id "(.*)"$/.exec(f);
    if (m) return { key: "duplicateLocation", params: { id: m[1] } };
    m = /^companySheet\.services: duplicate id "(.*)"$/.exec(f);
    if (m) return { key: "duplicateService", params: { id: m[1] } };
    m = /^companySheet\.services\.(\d+)\.locationIds: unknown location "(.*)"$/.exec(f);
    if (m) return { key: "unknownLocation", params: { service: sheet.services[Number(m[1])]?.name ?? "", id: m[2] } };
    if (f.startsWith("companySheet.identity.email")) return { key: "invalidEmail", params: {} };
    if (f.startsWith("companySheet.notes")) return { key: "notesTooLong", params: {} };
    return { key: "invalid", params: {} };
  });
}

/** Locale date of a learned site ("" when unknown). */
export function learnedDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d);
}

// ── Readable hours ("Mon–Thu 9:00–19:00, Fri 9:00–14:00, Sat–Sun closed") ──

type Week = CompanySheet["locations"][number]["hours"];
type Day = keyof Week;
const DAYS_FROM_SUNDAY: Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
// A fixed week (2026-11-01 is a Sunday) to name days in the viewer's language.
const SUNDAY = Date.UTC(2026, 10, 1);

export interface HoursRun {
  from: Day;
  to: Day;
  /** null = closed. */
  span: { open: string; close: string } | null;
}

/** Consecutive days with the same hours, in the week order of the locale (Hebrew: from Sunday). */
export function hoursRuns(hours: Week, locale: string): HoursRun[] {
  const order = locale === "he" ? DAYS_FROM_SUNDAY : [...DAYS_FROM_SUNDAY.slice(1), "sun" as Day];
  const runs: HoursRun[] = [];
  for (const d of order) {
    const h = hours[d];
    const span = h.open ? { open: h.openTime, close: h.closeTime } : null;
    const last = runs.at(-1);
    if (last && JSON.stringify(last.span) === JSON.stringify(span)) last.to = d;
    else runs.push({ from: d, to: d, span });
  }
  return runs;
}

export function dayName(d: Day, locale: string): string {
  const i = DAYS_FROM_SUNDAY.indexOf(d);
  return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(SUNDAY + i * 86_400_000));
}

/** One line; `closed` is the translated word. */
export function hoursSummary(hours: Week, locale: string, closed: string): string {
  return hoursRuns(hours, locale)
    .map((r) => {
      const days = r.from === r.to ? dayName(r.from, locale) : `${dayName(r.from, locale)}–${dayName(r.to, locale)}`;
      return `${days} ${r.span ? `${r.span.open}–${r.span.close}` : closed}`;
    })
    .join(", ");
}

// ── Learning from a site: a proposal, never a silent overwrite ──────────
//
// The scan's draft is merged into the sheet as a PROPOSAL the customer
// confirms (Apply / Cancel): new locations and services are added; a fact
// the customer already has and the site states differently is listed as a
// change; an empty field is filled; nothing is ever removed.

export type ScanChange =
  | { kind: "identity"; field: "name" | "tagline" | "email"; before: string; after: string }
  | { kind: "locationAdded"; name: string }
  | { kind: "locationChanged"; name: string; what: ("address" | "hours")[] }
  | { kind: "serviceAdded"; name: string; durationMinutes: number; priceILS: number }
  | { kind: "serviceChanged"; name: string; what: ("price" | "duration" | "description")[] }
  | { kind: "notesAdded" };

const key = (s: string) => s.trim().toLocaleLowerCase().replace(/\s+/g, " ");

export function planScan(sheet: CompanySheet, draft: BusinessConfig): { next: CompanySheet; changes: ScanChange[] } {
  const scanned = sheetFromBusiness(draft);
  const changes: ScanChange[] = [];

  const identity = { ...sheet.identity };
  for (const f of ["name", "tagline", "email"] as const) {
    const after = scanned.identity[f].trim();
    if (!after || after === identity[f].trim()) continue;
    changes.push({ kind: "identity", field: f, before: identity[f], after });
    identity[f] = after;
  }

  const locations = sheet.locations.map((l) => ({ ...l }));
  const locationIdMap = new Map<string, string>(); // scanned id → id in the sheet
  for (const l of scanned.locations) {
    const mine = locations.find((x) => key(x.name) === key(l.name));
    if (!mine) {
      const id = uniqueId(l.id, locations.map((x) => x.id));
      locations.push({ ...l, id });
      locationIdMap.set(l.id, id);
      changes.push({ kind: "locationAdded", name: l.name });
      continue;
    }
    locationIdMap.set(l.id, mine.id);
    const what: ("address" | "hours")[] = [];
    if (l.address.trim() && l.address.trim() !== mine.address.trim()) {
      mine.address = l.address;
      what.push("address");
    }
    if (JSON.stringify(l.hours) !== JSON.stringify(mine.hours)) {
      mine.hours = l.hours;
      what.push("hours");
    }
    if (what.length) changes.push({ kind: "locationChanged", name: mine.name, what });
  }

  const services = sheet.services.map((s) => ({ ...s }));
  for (const s of scanned.services) {
    const locationIds =
      s.locationIds === "all" ? ("all" as const) : s.locationIds.map((id) => locationIdMap.get(id)).filter((id): id is string => !!id);
    const mine = services.find((x) => key(x.name) === key(s.name));
    if (!mine) {
      services.push({ ...s, id: uniqueId(s.id, services.map((x) => x.id)), locationIds: locationIds.length || locationIds === "all" ? locationIds : "all" });
      changes.push({ kind: "serviceAdded", name: s.name, durationMinutes: s.durationMinutes, priceILS: s.priceILS });
      continue;
    }
    const what: ("price" | "duration" | "description")[] = [];
    if (s.priceILS > 0 && s.priceILS !== mine.priceILS) {
      mine.priceILS = s.priceILS;
      what.push("price");
    }
    if (s.durationMinutes > 0 && s.durationMinutes !== mine.durationMinutes) {
      mine.durationMinutes = s.durationMinutes;
      what.push("duration");
    }
    if (s.description.trim() && !mine.description.trim()) {
      mine.description = s.description;
      what.push("description");
    }
    if (what.length) changes.push({ kind: "serviceChanged", name: mine.name, what });
  }

  let notes = sheet.notes;
  const scannedNotes = scanned.notes.trim();
  if (scannedNotes && !notes.includes(scannedNotes)) {
    notes = [notes.trim(), scannedNotes].filter(Boolean).join("\n\n");
    changes.push({ kind: "notesAdded" });
  }

  return { next: { ...sheet, identity, locations, services, notes }, changes };
}

function uniqueId(id: string, taken: string[]): string {
  if (!taken.includes(id)) return id;
  let n = 2;
  while (taken.includes(`${id}-${n}`)) n++;
  return `${id}-${n}`;
}

/** The one-line count ("3 services added, 1 location changed"), as message params. */
export function scanCounts(changes: ScanChange[]) {
  return {
    servicesAdded: changes.filter((c) => c.kind === "serviceAdded").length,
    servicesChanged: changes.filter((c) => c.kind === "serviceChanged").length,
    locationsAdded: changes.filter((c) => c.kind === "locationAdded").length,
    locationsChanged: changes.filter((c) => c.kind === "locationChanged").length,
    identityChanged: changes.filter((c) => c.kind === "identity").length,
    notesAdded: changes.some((c) => c.kind === "notesAdded") ? 1 : 0,
  };
}
