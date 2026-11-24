// The admin "clear the company sheet" rules (pure: no DB, no network).
// The DB side is lib/company-sheet-reset.ts; the routes are
// app/api/admin/users/[userId]/reset-company-sheet/{route,undo/route}.ts.
// Stored in persona_resets with kind = 'company_sheet' (migration 0064).
//
// - What a reset writes (the values of an account that never had a sheet):
//     agent_configs.business  = DEFAULT_BUSINESS (lib/business.ts)
//     agent_configs.knowledge = [] (the column default: no legacy entries)
//     users.company_sheet     = NULL (what sign-up leaves; built lazily from
//                               `business` on read)
//   The legacy `knowledge` array MUST be cleared too: the inbound prompt
//   serves it whenever `business` is not "structured" (no name, centre nor
//   service: lib/knowledge/adapters.ts + render.ts), so an empty business
//   alone would bring the old entries back into calls.
// - Snapshot shape (previous / applied): { business, knowledge, companySheet? }
//   with companySheet ABSENT when the column is SQL NULL, so a restore tells
//   NULL from a stored JSON value. Values are copied jsonb to jsonb in SQL
//   (never through JS), so an undo is byte-exact.
// - Undo rule (same as the persona one, per kind): only the account's MOST
//   RECENT company-sheet reset, once, and only while the three values are
//   still exactly what that reset wrote. Otherwise 409 `edited_since_reset`
//   naming the fields; `force: true` restores anyway. A persona reset never
//   blocks a company-sheet undo, nor the reverse.

import { DEFAULT_BUSINESS, type BusinessConfig } from "@/lib/business";

export const RESET_KIND = "company_sheet" as const;

export const SHEET_FIELDS = ["business", "knowledge", "companySheet"] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];

/** What a reset writes. companySheet is absent: the column becomes NULL. */
export function clearedSheet(): { business: BusinessConfig; knowledge: [] } {
  return { business: structuredClone(DEFAULT_BUSINESS), knowledge: [] };
}

/** The fields whose current value is not what the reset wrote (`same` from the exact jsonb comparison). */
export function sheetEditedSinceReset(same: Record<SheetField, boolean | null | undefined>): SheetField[] {
  return SHEET_FIELDS.filter((f) => same[f] !== true);
}

/** A stored snapshot is restorable only if it holds business + knowledge (companySheet optional). */
export function isSheetSnapshot(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return !!o.business && typeof o.business === "object" && !Array.isArray(o.business) && "knowledge" in o && o.knowledge !== null;
}
