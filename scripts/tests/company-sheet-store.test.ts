// The account's companySheet stored alongside business (Knowledge S4):
// lib/knowledge/store.ts. Mock data only.
// Run with:  npx tsx scripts/tests/company-sheet-store.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { renderBusinessPromptBlock, sanitizeBusinessConfig } from "../../lib/business";
import { businessFromSheet, sheetFromBusiness } from "../../lib/knowledge/adapters";
import { EMPTY_COMPANY_SHEET } from "../../lib/knowledge/contract";
import { currentCompanySheet, planSheetWrite, sheetAfterBusinessWrite } from "../../lib/knowledge/store";
import { users } from "../../lib/db/schema";

const sql = readFileSync(new URL("../../drizzle/0044_company_sheet.sql", import.meta.url), "utf8");
assert.match(sql, /ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "company_sheet" jsonb;/);
assert.equal(users.companySheet.notNull, false);

const H = { open: true, openTime: "09:00", closeTime: "18:00" };
const hours = { sun: H, mon: H, tue: H, wed: H, thu: H, fri: H, sat: H };
const business = {
  identity: { name: "Salon Mock", tagline: "", email: "hello@example.test" },
  centres: [{ id: "c1", name: "Mock Centre", address: "1 Mock St", hours }],
  services: [{ id: "s1", name: "Mock Cut", durationMinutes: 30, priceILS: 120, centreIds: "all", description: "" }],
  centresRules: "",
  knowledgeBase: "Mock notes.",
};

// lazy: never written → built from today's business (no backfill)
assert.deepEqual(currentCompanySheet(null, business), sheetFromBusiness(sanitizeBusinessConfig(business)));
assert.deepEqual(currentCompanySheet(null, null), EMPTY_COMPANY_SHEET);
assert.deepEqual(currentCompanySheet({ broken: true }, business), sheetFromBusiness(sanitizeBusinessConfig(business)));

// a sheet write writes the business the calls read, and stores exactly it (+ FAQ/sources)
{
  const cur = currentCompanySheet(null, business);
  const w = planSheetWrite(cur, {
    identity: { tagline: "Mock tagline" }, // merged key by key
    services: [...cur.services, { id: "s2", name: "Mock Colour", durationMinutes: 60, priceILS: 300, locationIds: ["c1"], description: "" }],
    faq: [{ q: "Parking?", a: "Yes, mock street." }],
    sources: [{ url: "https://example.test", learnedAt: "2026-11-10" }],
  });
  assert.ok(w.ok);
  assert.equal(w.business.identity.name, "Salon Mock", "identity merged, name kept");
  assert.equal(w.business.identity.tagline, "Mock tagline");
  assert.equal(w.business.services.length, 2);
  // no drift: the stored sheet = what the business holds + FAQ/sources
  assert.deepEqual({ ...sheetFromBusiness(w.business), faq: w.sheet.faq, sources: w.sheet.sources }, w.sheet);
  assert.deepEqual(w.sheet.faq, [{ q: "Parking?", a: "Yes, mock street." }]);
  // what the receptionist is told = the business render of the stored sheet
  assert.equal(renderBusinessPromptBlock(businessFromSheet(w.sheet)), renderBusinessPromptBlock(w.business));
}

// anything the sanitizer would drop silently is refused (400) instead
{
  const cur = currentCompanySheet(null, business);
  const loc = cur.locations[0]!;
  for (const [patch, needle] of [
    [{ locations: [loc, loc] }, "duplicate id"],
    [{ services: [cur.services[0]!, cur.services[0]!] }, "duplicate id"],
    [{ services: [{ ...cur.services[0]!, locationIds: ["nope"] }] }, 'unknown location "nope"'],
    [{ identity: { email: "not-an-email" } }, "identity.email"],
    [{ notes: "x".repeat(6001) }, "notes: max 6000"],
  ] as const) {
    const w = planSheetWrite(cur, patch);
    assert.ok(!w.ok && w.status === 400 && w.error === "invalid_company_sheet", JSON.stringify(patch).slice(0, 60));
    assert.ok(w.fields.some((f) => f.includes(needle)), `${needle}: ${w.fields}`);
  }
  // schema errors too (strict, version can't be changed)
  const bad = planSheetWrite(cur, { extra: 1 });
  assert.ok(!bad.ok);
  const v = planSheetWrite(cur, { version: 2 });
  assert.ok(v.ok && v.sheet.version === 1, "version is not writable");
  assert.equal(planSheetWrite(cur, null).ok, false);
}

// a legacy business save refreshes the sheet and keeps FAQ + sources
{
  const stored = { ...sheetFromBusiness(sanitizeBusinessConfig(business)), faq: [{ q: "Q?", a: "A." }], sources: [{ url: "https://example.test", learnedAt: null }] };
  const after = sheetAfterBusinessWrite(stored, { ...business, identity: { ...business.identity, name: "Salon Mock 2" } });
  assert.equal(after.identity.name, "Salon Mock 2");
  assert.deepEqual(after.faq, stored.faq);
  assert.deepEqual(after.sources, stored.sources);
  assert.deepEqual(sheetAfterBusinessWrite(null, business), sheetFromBusiness(sanitizeBusinessConfig(business)), "first write = derived");
}

// no admin-only field in the sheet: a full tenant write of every field passes
{
  const cur = currentCompanySheet(null, business);
  assert.ok(planSheetWrite(cur, { ...cur, notes: "Tenant notes.", locationRules: "Tenant rules." }).ok);
}

console.log("ALL COMPANY-SHEET-STORE TESTS PASSED");
