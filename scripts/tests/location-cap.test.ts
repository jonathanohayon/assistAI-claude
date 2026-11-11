// Location caps per plan (lib/locations-cap.ts). Mock data only.
// Run with:  npx tsx scripts/tests/location-cap.test.ts
//
// The two write paths are tested through the SAME body → stored helpers the
// route handlers call (planCappedSheetWrite for PUT /api/dashboard/company-sheet,
// planConfigBusinessWrite for the `business` of PUT /api/dashboard/config).
// Admin case: under ?asUserId= the company-sheet route loads the TENANT's row
// (resolveTargetUserId), so the helper is fed the tenant's row and plan; the
// admin's own plan never enters the decision.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { planScan, sheetSaveIssues } from "../../components/bricks/knowledge/knowledge-ui";
import { sanitizeBusinessConfig, type BusinessConfig } from "../../lib/business";
import { currentCompanySheet } from "../../lib/knowledge/store";
import {
  LOCATION_CAPS,
  businessWithStoredCentres,
  capScannedLocations,
  checkLocationCount,
  locationCapFor,
  locationCapMessage,
  planCappedSheetWrite,
  planConfigBusinessWrite,
  scanResultWithCap,
} from "../../lib/locations-cap";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const H = { open: true, openTime: "09:00", closeTime: "18:00" };
const hours = { sun: H, mon: H, tue: H, wed: H, thu: H, fri: H, sat: H };
const centre = (n: number) => ({ id: `c${n}`, name: `Mock Centre ${n}`, address: `${n} Mock St`, hours });
const business = (n: number): BusinessConfig =>
  sanitizeBusinessConfig({
    identity: { name: "Salon Mock", tagline: "", email: "hello@example.test" },
    centres: Array.from({ length: n }, (_, i) => centre(i + 1)),
    services: [{ id: "s1", name: "Mock Cut", durationMinutes: 30, priceILS: 120, centreIds: "all", description: "" }],
    centresRules: "",
    knowledgeBase: "",
  });
const row = (n: number, plan: string) => ({ companySheet: null, business: business(n), plan });
const sheetOf = (r: ReturnType<typeof row>) => currentCompanySheet(r.companySheet, r.business);

function refused(w: { ok: boolean } & Record<string, unknown>, cap: number) {
  assert.equal(w.ok, false);
  assert.equal(w.status, 403);
  assert.deepEqual(w.body, { error: "location_cap", field: "centres", cap, message: locationCapMessage(cap) });
}

console.log("caps");
test("one constant: global 1, premium 3, whatsapp 1", () => {
  assert.deepEqual(LOCATION_CAPS, { whatsapp: 1, global: 1, premium: 3 });
  assert.equal(locationCapFor("global"), 1);
  assert.equal(locationCapFor("premium"), 3);
  assert.equal(locationCapFor("whatsapp"), 1);
  // unknown plan (legacy column default) → PLANS[0] (global), like the session config
  assert.equal(locationCapFor("essential"), 1);
  assert.equal(locationCapFor(null), 1);
});
test("refused only when the new count is above the cap AND above the stored count", () => {
  assert.equal(checkLocationCount(1, 0, 1).ok, true);
  assert.equal(checkLocationCount(2, 1, 1).ok, false);
  assert.equal(checkLocationCount(3, 3, 1).ok, true); // grandfathered, unchanged count
  assert.equal(checkLocationCount(2, 3, 1).ok, true); // shrinking
  assert.equal(checkLocationCount(4, 3, 1).ok, false);
  assert.equal(checkLocationCount(3, 2, 3).ok, true);
  assert.equal(checkLocationCount(4, 3, 3).ok, false);
});
test("the server/dev string states the plan, with no \"remove one\" advice", () => {
  assert.equal(locationCapMessage(1), "Your plan includes 1 location.");
  assert.equal(locationCapMessage(3), "Your plan includes 3 locations.");
});
test("the 3 locale files carry the cap strings with ICU plural forms", () => {
  const forms: Record<string, string[]> = { en: ["one", "other"], fr: ["one", "other"], he: ["one", "two", "other"] };
  for (const [lang, need] of Object.entries(forms)) {
    const kb = JSON.parse(readFileSync(new URL(`../../messages/${lang}.json`, import.meta.url), "utf8")).KnowledgeBrick;
    const issue: string = kb.issue.locationCap;
    const review: string = kb.reviewLocationCap;
    assert.ok(typeof kb.seePlans === "string" && kb.seePlans.length > 0, `${lang}: seePlans`);
    assert.match(issue, /\{cap, plural,/, `${lang}: issue.locationCap plural on cap`);
    assert.match(review, /\{dropped, plural,/, `${lang}: reviewLocationCap plural on dropped`);
    assert.match(review, /\{cap, plural,/, `${lang}: reviewLocationCap plural on cap`);
    for (const f of need) {
      assert.ok(issue.includes(` ${f} {`) || issue.includes(`,${f} {`), `${lang}: issue.locationCap form ${f}`);
      assert.ok(review.includes(` ${f} {`), `${lang}: reviewLocationCap form ${f}`);
    }
    assert.ok(!/\(s\)|remove one|retirez|הסירו/i.test(issue + review), `${lang}: no "(s)" and no "remove one" advice`);
  }
  // en/fr exact wording
  const en = JSON.parse(readFileSync(new URL("../../messages/en.json", import.meta.url), "utf8")).KnowledgeBrick;
  assert.equal(en.issue.locationCap, "Your plan includes {cap, plural, one {# location} other {# locations}}.");
  assert.equal(en.seePlans, "See plans");
  const fr = JSON.parse(readFileSync(new URL("../../messages/fr.json", import.meta.url), "utf8")).KnowledgeBrick;
  assert.equal(fr.issue.locationCap, "Votre forfait comprend {cap, plural, one {# établissement} other {# établissements}}.");
  assert.equal(fr.seePlans, "Voir les forfaits");
});

// ── The four gate cases, company sheet, tenant AND admin (tenant's row) ──
for (const who of ["tenant", "admin via asUserId"]) {
  console.log(`gate — PUT /api/dashboard/company-sheet — ${who}`);
  const r = row(1, "global");
  const sheet = sheetOf(r);
  test(`(1) other fields pass [${who}]`, () => {
    const w = planCappedSheetWrite(r, { identity: { tagline: "Mock tagline" } });
    assert.equal(w.ok, true);
    if (w.ok) assert.equal(w.business.identity.tagline, "Mock tagline");
  });
  test(`(2) an unchanged re-send passes [${who}]`, () => {
    const w = planCappedSheetWrite(r, { locations: sheet.locations });
    assert.equal(w.ok, true);
    if (w.ok) assert.deepEqual(w.business.centres, r.business.centres);
  });
  test(`(3) a change that exceeds the cap → 403 naming centres [${who}]`, () => {
    const w = planCappedSheetWrite(r, { locations: [...sheet.locations, { ...sheet.locations[0], id: "c9", name: "Mock New" }] });
    refused(w as never, 1);
  });
  test(`(4) a save that OMITS locations leaves the stored value [${who}]`, () => {
    const w = planCappedSheetWrite(r, { notes: "Mock notes" });
    assert.equal(w.ok, true);
    if (w.ok) assert.deepEqual(w.business.centres, r.business.centres);
  });
}

// ── The four gate cases, legacy `business` of PUT /api/dashboard/config ──
// That route writes the session's own account only (an admin's own row);
// admins edit a tenant through /api/admin/configs/[userId], which never
// writes `business`.
for (const who of ["tenant", "admin (own account)"]) {
  console.log(`gate — PUT /api/dashboard/config business — ${who}`);
  const stored = business(1);
  test(`(1) other fields pass [${who}]`, () => {
    const w = planConfigBusinessWrite({ ...stored, identity: { ...stored.identity, tagline: "Mock" } }, stored, "global");
    assert.equal(w.ok, true);
    if (w.ok) assert.equal(w.business.identity.tagline, "Mock");
  });
  test(`(2) an unchanged re-send passes [${who}]`, () => {
    const w = planConfigBusinessWrite(JSON.parse(JSON.stringify(stored)), stored, "global");
    assert.equal(w.ok, true);
    if (w.ok) assert.deepEqual(w.business, stored);
  });
  test(`(3) a change that exceeds the cap → 403 naming centres [${who}]`, () => {
    refused(planConfigBusinessWrite({ ...stored, centres: [...stored.centres, centre(2)] }, stored, "global") as never, 1);
  });
  test(`(4) a business that OMITS centres keeps the stored centres [${who}]`, () => {
    const { centres: _omit, ...rest } = stored;
    void _omit;
    const w = planConfigBusinessWrite(rest, stored, "global");
    assert.equal(w.ok, true);
    if (w.ok) assert.deepEqual(w.business.centres, stored.centres);
  });
}
test("absent ≠ empty: an explicit empty list still clears (shrinking passes)", () => {
  const w = planConfigBusinessWrite({ ...business(1), centres: [] }, business(1), "global");
  assert.equal(w.ok, true);
  if (w.ok) assert.deepEqual(w.business.centres, []);
  assert.deepEqual(businessWithStoredCentres(null, [centre(1)]), null);
});

console.log("cap per plan");
test("global: a 2nd location is refused; premium: up to 3, a 4th refused", () => {
  const add = (r: ReturnType<typeof row>, n: number) => planCappedSheetWrite(r, { locations: [...sheetOf(r).locations, { ...sheetOf(r).locations[0], id: `c${n}`, name: `Mock New ${n}` }] });
  refused(add(row(1, "global"), 2) as never, 1);
  assert.equal(add(row(1, "premium"), 2).ok, true);
  assert.equal(add(row(2, "premium"), 3).ok, true);
  refused(add(row(3, "premium"), 4) as never, 3);
  // first location on an empty account
  const empty = row(0, "global");
  const w = planCappedSheetWrite(empty, { locations: [{ ...sheetOf(row(1, "global")).locations[0] }] });
  assert.equal(w.ok, true);
});

// ── tamaraVP's required case: 3 locations on a plan capped at 1 ─────────
console.log("grandfathered: 3 locations on a plan capped at 1");
{
  const r = row(3, "global");
  const sheet = sheetOf(r);
  test("(a) editing one location's fields passes", () => {
    const locations = sheet.locations.map((l, i) => (i === 1 ? { ...l, address: "99 Mock Ave" } : l));
    const w = planCappedSheetWrite(r, { locations });
    assert.equal(w.ok, true);
    if (w.ok) {
      assert.equal(w.business.centres.length, 3);
      assert.equal(w.business.centres[1].address, "99 Mock Ave");
    }
    // same through the legacy business route
    const lw = planConfigBusinessWrite({ ...r.business, centres: r.business.centres.map((c, i) => (i === 0 ? { ...c, name: "Mock Renamed" } : c)) }, r.business, "global");
    assert.equal(lw.ok, true);
  });
  test("(b) deleting one passes", () => {
    const w = planCappedSheetWrite(r, { locations: sheet.locations.slice(1) });
    assert.equal(w.ok, true);
    if (w.ok) assert.equal(w.business.centres.length, 2);
  });
  test("(c) adding a 4th is refused, with the message", () => {
    const w = planCappedSheetWrite(r, { locations: [...sheet.locations, { ...sheet.locations[0], id: "c4", name: "Mock Centre 4" }] });
    refused(w as never, 1);
    assert.equal((w as { body: { message: string } }).body.message, "Your plan includes 1 location.");
    assert.deepEqual(sheetSaveIssues((w as unknown as { body: { error: string; cap: number } }).body, sheet), [{ key: "locationCap", params: { cap: 1 } }]);
    refused(planConfigBusinessWrite({ ...r.business, centres: [...r.business.centres, centre(4)] }, r.business, "global") as never, 1);
  });
  test("(d) a website scan finding new locations keeps all 3 existing ones and adds none", () => {
    const draft = sanitizeBusinessConfig({
      identity: { name: "Salon Mock", tagline: "", email: "" },
      centres: [centre(1), { ...centre(7), id: "n7", name: "Mock Scanned 7" }, { ...centre(8), id: "n8", name: "Mock Scanned 8" }],
      services: [],
    });
    const { next, changes, locationsTruncated, locationsDropped } = planScan(sheet, draft, new Set(), 1);
    assert.equal(locationsTruncated, true);
    assert.equal(locationsDropped, 2); // said in the review, never silent
    assert.deepEqual(next.locations.map((l) => l.id), ["c1", "c2", "c3"]);
    assert.equal(changes.filter((c) => c.kind === "locationAdded").length, 0);
    // the save it leads to passes the gate (nothing added)
    assert.equal(planCappedSheetWrite(r, { locations: next.locations }).ok, true);
    // the server marks the scan result truncated
    const ev = scanResultWithCap({ type: "result", business: draft }, r.business.centres, "global");
    assert.equal(ev.locationCap, 1);
    assert.equal(ev.centresTruncated, true);
    assert.equal(ev.centresDropped, 2);
  });
}

console.log("scan truncation (automatic merge never removes, adds within room)");
test("premium with 1 location, site lists 4 new → the first 2 are added, flagged", () => {
  const r = row(1, "premium");
  const sheet = sheetOf(r);
  const draft = sanitizeBusinessConfig({
    identity: { name: "", tagline: "", email: "" },
    centres: [4, 5, 6, 7].map((n) => ({ ...centre(n), id: `n${n}`, name: `Mock Scanned ${n}` })),
    services: [],
  });
  const { next, locationsTruncated, locationsDropped, changes } = planScan(sheet, draft, new Set(), 3);
  assert.equal(locationsTruncated, true);
  assert.equal(locationsDropped, 2);
  assert.deepEqual(next.locations.map((l) => l.name), ["Mock Centre 1", "Mock Scanned 4", "Mock Scanned 5"]);
  assert.equal(changes.filter((c) => c.kind === "locationAdded").length, 2);
  assert.equal(planCappedSheetWrite(r, { locations: next.locations }).ok, true);
  assert.equal(scanResultWithCap({ type: "result", business: draft }, r.business.centres, "premium").centresTruncated, true);
});
test("a scanned location matching an existing one is an update, never counted as new", () => {
  const { kept, truncated } = capScannedLocations([{ name: "Mock Centre 1" }], [{ name: "  mock centre 1 " }], 1);
  assert.equal(kept.length, 1);
  assert.equal(truncated, false);
});
test("within the cap: not flagged, and planScan without a cap is unchanged", () => {
  const r = row(0, "global");
  const draft = sanitizeBusinessConfig({ identity: { name: "", tagline: "", email: "" }, centres: [centre(1)], services: [] });
  const capped = planScan(sheetOf(r), draft, new Set(), 1);
  assert.equal(capped.locationsTruncated, false);
  assert.equal(capped.locationsDropped, 0);
  assert.equal(capped.next.locations.length, 1);
  const uncapped = planScan(sheetOf(r), draft);
  assert.deepEqual(uncapped.next, capped.next);
  assert.equal(uncapped.locationsTruncated, false);
});

console.log(`location-cap: ${passed} passed`);
