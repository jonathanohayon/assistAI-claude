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
