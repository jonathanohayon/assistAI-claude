// Knowledge brick (S3): save patch, scan → sheet, server issues, sources.
// Mock data only.
// Run with:  npx tsx scripts/tests/knowledge-brick.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { BusinessConfig } from "../../lib/business";
import { EMPTY_COMPANY_SHEET, type CompanySheet } from "../../lib/knowledge/contract";
import { planSheetWrite } from "../../lib/knowledge/store";
import {
  applyScan,
  hoursRuns,
  planScan,
  scanCounts,
  hoursSummary,
  businessFromSheet,
  sameSite,
  sheetIssues,
  sheetPatch,
  withFacts,
  withSource,
  SOURCES_MAX,
} from "../../components/bricks/knowledge/knowledge-ui";

const closed = { open: false, openTime: "09:00", closeTime: "18:00" };
const hours = { sun: closed, mon: { ...closed, open: true }, tue: closed, wed: closed, thu: closed, fri: closed, sat: closed };
const SHEET: CompanySheet = {
  ...EMPTY_COMPANY_SHEET,
  identity: { name: "Salon Mock", tagline: "", email: "" },
  locations: [{ id: "l1", name: "Centre Mock", address: "1 rue Mock", hours }],
  services: [{ id: "s1", name: "Coupe", durationMinutes: 30, priceILS: 100, locationIds: "all", description: "" }],
  faq: [{ q: "Parking ?", a: "Oui." }],
  sources: [{ url: "https://mock.example", learnedAt: "2026-11-01T00:00:00.000Z" }],
};

// 1. Patch: nothing changed → empty; identity key by key; other keys whole
{
  assert.deepEqual(sheetPatch(SHEET, structuredClone(SHEET)), {});
  const next = { ...SHEET, identity: { ...SHEET.identity, email: "mock@example.test" } };
  assert.deepEqual(sheetPatch(SHEET, next), { identity: { email: "mock@example.test" } });
  const svc = [...SHEET.services, { ...SHEET.services[0], id: "s2", name: "Couleur" }];
  assert.deepEqual(sheetPatch(SHEET, { ...SHEET, services: svc }), { services: svc });
  assert.deepEqual(sheetPatch(SHEET, { ...SHEET, notes: "x" }), { notes: "x" });
  assert.ok(!("version" in sheetPatch(SHEET, { ...SHEET, notes: "x" })));
}

// 2. The patch, applied by the server's own merge, gives the edited sheet
{
  const next: CompanySheet = {
    ...SHEET,
    identity: { ...SHEET.identity, tagline: "Coiffure" },
    faq: [...SHEET.faq, { q: "Cartes ?", a: "Oui." }],
    locationRules: "Le mercredi : Centre Mock.",
  };
  const plan = planSheetWrite(SHEET, sheetPatch(SHEET, next));
  assert.ok(plan.ok);
  if (plan.ok) assert.deepEqual(plan.sheet, next);
}

// 3. Scan → sheet: facts from the scan, FAQ kept, site recorded once
{
  const scanned: BusinessConfig = { ...businessFromSheet(SHEET), identity: { name: "Salon Mock 2", tagline: "", email: "" } };
  const out = applyScan(SHEET, scanned, "http://www.MOCK.example/", "2026-11-10T00:00:00.000Z");
  assert.equal(out.identity.name, "Salon Mock 2");
  assert.deepEqual(out.faq, SHEET.faq);
  assert.equal(out.sources.length, 1);
  assert.equal(out.sources[0].learnedAt, "2026-11-10T00:00:00.000Z");
  assert.ok(sameSite("https://mock.example", "mock.example/"));
  assert.ok(!sameSite("https://mock.example", "https://other.example"));
  const many = Array.from({ length: SOURCES_MAX }, (_, i) => ({ url: `https://m${i}.example`, learnedAt: null }));
  const capped = withSource(many, "https://new.example", "2026-11-10T00:00:00.000Z");
  assert.equal(capped.length, SOURCES_MAX);
  assert.equal(capped[0].url, "https://new.example");
  assert.deepEqual(withSource(SHEET.sources, "  ", "x"), SHEET.sources);
}

// 4. Every 400 the server can send maps to a translated message
{
  const bad: CompanySheet = {
    ...SHEET,
    services: [...SHEET.services, { ...SHEET.services[0], id: "s2", name: "Couleur", locationIds: ["nope"] }],
  };
  const plan = planSheetWrite(SHEET, { services: bad.services });
  assert.ok(!plan.ok);
  if (!plan.ok) {
    assert.deepEqual(sheetIssues(plan.fields, bad), [{ key: "unknownLocation", params: { service: "Couleur", id: "nope" } }]);
  }
  const dupLoc = planSheetWrite(SHEET, { locations: [SHEET.locations[0], SHEET.locations[0]] });
  assert.ok(!dupLoc.ok && sheetIssues(dupLoc.fields, SHEET)[0].key === "duplicateLocation");
  const email = planSheetWrite(SHEET, { identity: { email: "nope" } });
  assert.ok(!email.ok && sheetIssues(email.fields, SHEET)[0].key === "invalidEmail");
  const notes = planSheetWrite(SHEET, { notes: "x".repeat(6001) });
  assert.ok(!notes.ok && sheetIssues(notes.fields, SHEET)[0].key === "notesTooLong");
  assert.equal(sheetIssues(["companySheet.faq.0.q: too small"], SHEET)[0].key, "invalid");
}

// 5. Editors work on the business shape: a round trip changes nothing, FAQ/sources/rules kept
{
  assert.deepEqual(withFacts(SHEET, businessFromSheet(SHEET)), SHEET);
  const b = businessFromSheet(SHEET);
  const out = withFacts(SHEET, { ...b, services: [] });
  assert.deepEqual(out.services, []);
  assert.deepEqual(out.faq, SHEET.faq);
  assert.deepEqual(out.sources, SHEET.sources);
}

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// 6. One module on both screens; the old panel and tile are gone
{
  const inbound = read("app/[locale]/dashboard/config-form.tsx");
  const outbound = read("app/[locale]/dashboard/campaigns/agents/agent-editor.tsx");
  for (const [name, src] of [["config-form", inbound], ["agent-editor", outbound]] as const) {
    assert.match(src, /import \{ KnowledgeBrick \} from "@\/components\/bricks\/knowledge\/KnowledgeBrick"/, `${name} imports the brick`);
    assert.match(src, /<KnowledgeBrick\b/, `${name} renders the brick`);
    assert.doesNotMatch(src, /function BusinessPanel\b|<BusinessPanel\b/, `${name}: no old business panel`);
  }
  assert.match(inbound, /kind="inbound"/);
  assert.match(outbound, /kind="outbound"/);
  assert.ok(!existsSync(join(ROOT, "app/[locale]/dashboard/config/business-panel.tsx")));
  // The sheet saves through its own endpoint; `business` is not sent with the config.
  assert.match(inbound, /\/api\/dashboard\/company-sheet/);
  assert.match(inbound, /const \{ business: _sheetOwned, \.\.\.agentFields \} = form;/);
  assert.match(read("app/[locale]/dashboard/campaigns/agents/agents-workspace.tsx"), /\/api\/dashboard\/company-sheet/);
}

// 7. Inheritance of shared directives: admin only, never in the tenant-visible persona panel
{
  assert.doesNotMatch(read("app/[locale]/dashboard/config/persona-panel.tsx"), /inheritAdminGlobals/);
  const inbound = read("app/[locale]/dashboard/config-form.tsx");
  assert.match(inbound, /isAdmin \? \(\s*<div className="flex flex-col gap-4">\s*<InheritAdminField/);
  assert.equal(inbound.match(/<InheritAdminField\b/g)?.length, 1);
}

// 8. Copy: same keys in the three languages
{
  const keys = (o: Record<string, unknown>, pre = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v as Record<string, unknown>, `${pre}${k}.`) : [`${pre}${k}`]));
  const [fr, en, he] = ["fr", "en", "he"].map((l) => keys(JSON.parse(read(`messages/${l}.json`)).KnowledgeBrick).sort());
  assert.deepEqual(en, fr);
  assert.deepEqual(he, fr);
  for (const k of ["issue.duplicateLocation", "issue.duplicateService", "issue.unknownLocation", "issue.invalidEmail", "issue.notesTooLong", "issue.invalid"])
    assert.ok(fr.includes(k), k);
}


// 9. Readable hours: runs of equal days, locale week order, closed days named
{
  const open = (o: string, c: string) => ({ open: true, openTime: o, closeTime: c });
  const off = { open: false, openTime: "09:00", closeTime: "18:00" };
  const week = { sun: off, mon: open("09:00", "19:00"), tue: open("09:00", "19:00"), wed: open("09:00", "19:00"), thu: open("09:00", "20:00"), fri: open("09:00", "14:00"), sat: off };
  assert.deepEqual(
    hoursRuns(week, "fr").map((r) => `${r.from}-${r.to}`),
    ["mon-wed", "thu-thu", "fri-fri", "sat-sun"],
  );
  assert.deepEqual(hoursRuns(week, "he").map((r) => `${r.from}-${r.to}`), ["sun-sun", "mon-wed", "thu-thu", "fri-fri", "sat-sat"]);
  assert.equal(hoursSummary(week, "en", "closed"), "Mon–Wed 09:00–19:00, Thu 09:00–20:00, Fri 09:00–14:00, Sat–Sun closed");
  const allOff = Object.fromEntries(Object.keys(week).map((d) => [d, off])) as typeof week;
  assert.equal(hoursSummary(allOff, "en", "closed"), "Mon–Sun closed");
  console.log("HOURS SUMMARY OK");
}

// 10. Learning = a proposal: adds, fills, lists changes; never removes or silently overwrites
{
  const draft: BusinessConfig = {
    identity: { name: "Salon Mock", tagline: "Coiffure", email: "" },
    centres: [
      { id: "x1", name: "centre mock", address: "1 rue Mock", hours: { ...hours, tue: { open: true, openTime: "10:00", closeTime: "18:00" } } },
      { id: "x2", name: "Annexe Mock", address: "2 rue Mock", hours },
    ],
    services: [
      { id: "s1", name: "coupe", durationMinutes: 30, priceILS: 120, centreIds: ["x1"], description: "" },
      { id: "s1", name: "Brushing", durationMinutes: 20, priceILS: 60, centreIds: ["x2"], description: "" },
    ],
    centresRules: "",
    knowledgeBase: "Spécialiste mock.",
  };
  const { next, changes } = planScan(SHEET, draft);
  assert.equal(next.identity.name, "Salon Mock");
  assert.equal(next.identity.tagline, "Coiffure");
  assert.equal(next.locations.length, 2, "no location removed, one added");
  assert.equal(next.locations[0].id, "l1", "matched by name, id kept");
  assert.equal(next.services.length, 2);
  assert.equal(next.services[0].priceILS, 120);
  assert.equal(next.services[1].id, "s1-2", "colliding scanned id renamed");
  assert.deepEqual(next.services[1].locationIds, [next.locations[1].id], "scanned location ids remapped");
  assert.deepEqual(next.faq, SHEET.faq);
  assert.deepEqual(scanCounts(changes), { servicesAdded: 1, servicesChanged: 1, locationsAdded: 1, locationsChanged: 1, identityChanged: 1, notesAdded: 1 });
  assert.deepEqual(changes.find((c) => c.kind === "locationChanged"), { kind: "locationChanged", name: "Centre Mock", what: ["hours"] });
  // The proposal is valid for the server (no duplicate or unknown ids).
  assert.ok(planSheetWrite(SHEET, sheetPatch(SHEET, next)).ok);
  // A scan that states nothing new changes nothing.
  const same = planScan(SHEET, businessFromSheet(SHEET));
  assert.deepEqual(same.changes, []);
  assert.deepEqual(same.next, SHEET);
}

// 11. Every static key the brick's files ask for exists (fr = reference, 8. checks the others)
{
  const fr = JSON.parse(read("messages/fr.json")).KnowledgeBrick;
  const has = (k: string) => k.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), fr) !== undefined;
  for (const f of ["KnowledgeBrick.tsx", "SheetCard.tsx", "SessionPreview.tsx"]) {
    const src = read(`components/bricks/knowledge/${f}`);
    for (const m of src.matchAll(/\bt(?:\.rich)?\("([A-Za-z0-9_.]+)"/g)) assert.ok(has(m[1]), `${f}: missing KnowledgeBrick.${m[1]}`);
  }
  // No salon word and no product name in this brick's copy, any language — except the
  // agreed "Tamara adds its own rules" line of the tenant preview.
  for (const l of ["fr", "en", "he"]) {
    const kb = { ...JSON.parse(read(`messages/${l}.json`)).KnowledgeBrick };
    delete kb.controlHint;
    assert.doesNotMatch(JSON.stringify(kb), /\bsoins?\b|salon|coiffure|טיפול|Tamara/i, `${l}: salon word or product name`);
  }
}

console.log("ALL KNOWLEDGE-BRICK TESTS PASSED");
