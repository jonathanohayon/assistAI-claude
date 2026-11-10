// Storing the account's companySheet (Knowledge S4, write-alongside). Pure.
//
// - users.company_sheet holds the sheet (NULL = never written: built LAZILY
//   from agent_configs.business on read — no backfill).
// - agent_configs.business stays the READ SOURCE of calls, so:
//     · a companySheet write ALSO writes `business` (through the same
//       sanitizer as the business editor), and the stored sheet is exactly
//       what that business holds + the parts business can't hold (FAQ,
//       sources) — so the two never drift;
//     · a legacy `business` save refreshes the stored sheet, keeping FAQ and
//       sources.
// - Anything the sanitizer would silently drop is refused instead (400), so
//   a save never loses data without saying so.
// - No admin-only field in the sheet: every field is the tenant's.

import { sanitizeBusinessConfig, type BusinessConfig } from "@/lib/business";
import { businessFromSheet, sheetFromBusiness } from "@/lib/knowledge/adapters";
import { parseCompanySheet, type CompanySheet } from "@/lib/knowledge/contract";

/** The account's business-JSON caps (lib/business.ts sanitizer). */
const BUSINESS_NOTES_MAX = 6000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SheetWrite =
  | { ok: true; sheet: CompanySheet; business: BusinessConfig }
  | { ok: false; status: 400; error: string; fields: string[] };

/** The stored sheet if valid, else built from the business JSON. */
export function currentCompanySheet(stored: unknown, business: unknown): CompanySheet {
  const s = parseCompanySheet(stored);
  return s.ok ? s.value : sheetFromBusiness(sanitizeBusinessConfig(business));
}

/** Partial write: top-level keys replace, `identity` merges key by key. */
function merge(current: CompanySheet, patch: Record<string, unknown>): unknown {
  const identity = patch.identity && typeof patch.identity === "object" ? (patch.identity as Record<string, unknown>) : {};
  return { ...current, ...patch, version: current.version, identity: { ...current.identity, ...identity } };
}

/** What the sanitizer would drop silently → explicit errors. */
function silentDrops(s: CompanySheet): string[] {
  const out: string[] = [];
  const dup = (ids: string[]) => ids.find((id, i) => ids.indexOf(id) !== i);
  const dl = dup(s.locations.map((l) => l.id));
  if (dl) out.push(`companySheet.locations: duplicate id "${dl}"`);
  const ds = dup(s.services.map((x) => x.id));
  if (ds) out.push(`companySheet.services: duplicate id "${ds}"`);
  const known = new Set(s.locations.map((l) => l.id));
  s.services.forEach((x, i) => {
    if (x.locationIds !== "all") {
      const bad = x.locationIds.find((id) => !known.has(id));
      if (bad) out.push(`companySheet.services.${i}.locationIds: unknown location "${bad}"`);
    }
  });
  if (s.identity.email.trim() && !EMAIL_RE.test(s.identity.email.trim())) out.push("companySheet.identity.email: invalid");
  if (s.notes.trim().length > BUSINESS_NOTES_MAX) out.push(`companySheet.notes: max ${BUSINESS_NOTES_MAX} characters`);
  return out;
}

export function planSheetWrite(current: CompanySheet, patch: unknown): SheetWrite {
  if (!patch || typeof patch !== "object") {
    return { ok: false, status: 400, error: "invalid_company_sheet", fields: ["companySheet: invalid"] };
  }
  const parsed = parseCompanySheet(merge(current, patch as Record<string, unknown>));
  if (!parsed.ok) return { ok: false, status: 400, error: "invalid_company_sheet", fields: [parsed.error] };
  const drops = silentDrops(parsed.value);
  if (drops.length) return { ok: false, status: 400, error: "invalid_company_sheet", fields: drops };
  // The business the calls will read, and the sheet stored = exactly that
  // business (normalized: trimmed strings, valid hours) + FAQ and sources.
  const business = sanitizeBusinessConfig(businessFromSheet(parsed.value));
  return { ok: true, business, sheet: withExtras(sheetFromBusiness(business), parsed.value) };
}

/** After a legacy `business` save: re-derive, keep FAQ and sources. */
export function sheetAfterBusinessWrite(stored: unknown, business: unknown): CompanySheet {
  const derived = sheetFromBusiness(sanitizeBusinessConfig(business));
  const s = parseCompanySheet(stored);
  return s.ok ? withExtras(derived, s.value) : derived;
}

function withExtras(base: CompanySheet, from: CompanySheet): CompanySheet {
  return { ...base, faq: from.faq, sources: from.sources };
}
