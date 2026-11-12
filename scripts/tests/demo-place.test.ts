// lib/demo-place.ts: the home demo's one fictional place and its fact sheet,
// and the guards that keep any stored account text out of the demo prompt.
// The DB-backed end-to-end check is scripts/demo-sheet-db.sh.
// Run with:  npx tsx scripts/tests/demo-place.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { anonymousDemoInstructions } from "../../lib/demo-instructions";
import {
  DEMO_CLOSE_TIME,
  DEMO_LANGS,
  DEMO_OPEN_DAYS,
  DEMO_OPEN_TIME,
  DEMO_PLACE,
  DEMO_PLACE_ID,
  DEMO_SERVICES,
  DEMO_SLOTS,
  demoCurrency,
  demoLang,
  demoSheetBlock,
} from "../../lib/demo-place";
import * as tools from "../../lib/demo-tools";
import { LOCALE_TO_CURRENCY, landingCurrencyFor } from "../../lib/landing-currency";
import { CENTERS, labelFor } from "../../lib/schedule";
import { SCHEDULE_PLACES } from "./fixtures/demo-sheet/real-places";

async function main() {
  // The canned place, word for word (the same strings as the canned tools).
  assert.deepEqual(DEMO_PLACE, {
    fr: "notre salon du centre-ville",
    en: "our downtown salon",
    he: "הסלון שלנו במרכז העיר",
  });
  assert.equal(DEMO_PLACE_ID, "demo_salon");
  assert.equal(demoLang("he"), "he");
  assert.equal(demoLang("xx"), "fr");
  assert.equal(demoLang(undefined), "fr");

  // Open days by language; Saturday (6) always closed.
  assert.deepEqual(DEMO_OPEN_DAYS.fr, [1, 2, 3, 4, 5]);
  assert.deepEqual(DEMO_OPEN_DAYS.en, [1, 2, 3, 4, 5]);
  assert.deepEqual(DEMO_OPEN_DAYS.he, [0, 1, 2, 3, 4]);
  for (const l of DEMO_LANGS) assert.ok(!DEMO_OPEN_DAYS[l].includes(6), `${l}: Saturday closed`);
  assert.deepEqual([...DEMO_SLOTS], ["10:00", "11:30", "15:00"]);
  assert.equal(DEMO_OPEN_TIME, DEMO_SLOTS[0]);

  // Every service fits after the last slot, before closing.
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  for (const s of DEMO_SERVICES) {
    assert.ok(minutes(DEMO_SLOTS[DEMO_SLOTS.length - 1]!) + s.durationMinutes <= minutes(DEMO_CLOSE_TIME), s.name.fr);
    for (const l of DEMO_LANGS) assert.ok(s.name[l].trim(), `${s.name.fr} ${l}`);
    for (const c of ["EUR", "USD", "ILS"] as const) assert.ok(s.price[c] > 0, `${s.name.fr} ${c}`);
  }

  // Currency: the landing Pricing section's rule for the locale, not a second table.
  for (const l of DEMO_LANGS) assert.equal(demoCurrency(l), landingCurrencyFor(l), l);
  assert.equal(demoCurrency("fr"), LOCALE_TO_CURRENCY.fr);
  assert.match(demoSheetBlock("fr"), new RegExp(`${DEMO_SERVICES[0]!.price.ILS} ₪`));
  assert.match(demoSheetBlock("he"), new RegExp(`${DEMO_SERVICES[0]!.price.ILS} ₪`));
  assert.match(demoSheetBlock("en"), new RegExp(`${DEMO_SERVICES[0]!.price.USD} \\$`));
  const pricing = readFileSync("components/marketing/Pricing.tsx", "utf8");
  assert.match(pricing, /landingCurrencyFor\(locale\)/, "the Pricing section uses the same function");
  assert.doesNotMatch(readFileSync("components/plans/PlanCard.tsx", "utf8"), /fr: "ILS"/, "one locale table");

  // The real-place list covers every lib/schedule centre label.
  for (const c of CENTERS) assert.match(labelFor(c), SCHEDULE_PLACES, c);
  for (const town of ["Jerusalem", "Netanya", "ירושלים", "אשדוד", "נתניה"]) assert.match(town, SCHEDULE_PLACES);

  // The sheet, per language: the place, the services, the right week, no real place.
  for (const l of DEMO_LANGS) {
    const sheet = demoSheetBlock(l);
    assert.ok(sheet.includes(`« ${DEMO_PLACE[l]} »`), `${l}: place`);
    for (const s of DEMO_SERVICES) assert.ok(sheet.includes(s.name[l]), `${l}: ${s.name[l]}`);
    assert.match(sheet, /samedi : fermé/);
    assert.doesNotMatch(sheet, SCHEDULE_PLACES);
  }
  assert.match(demoSheetBlock("he"), /dimanche : 10:00–18:00/);
  assert.match(demoSheetBlock("he"), /vendredi : fermé/);
  assert.match(demoSheetBlock("fr"), /dimanche : fermé/);
  assert.match(demoSheetBlock("en"), /vendredi : 10:00–18:00/);
  assert.equal(demoSheetBlock("xx"), demoSheetBlock("fr"));

  // The demo prompt carries the sheet, and no real place.
  for (const l of DEMO_LANGS) {
    const prompt = anonymousDemoInstructions(l);
    assert.ok(prompt.includes(demoSheetBlock(l)), `${l}: sheet`);
    assert.doesNotMatch(prompt, SCHEDULE_PLACES);
  }

  // The demo loader reads the voice and the model only: no stored text.
  const loader = readFileSync("lib/demo-agent.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");
  const selected = [...loader.matchAll(/agentConfigs\.(\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(selected, ["model", "userId", "voice"]);
  assert.doesNotMatch(loader, /@\/lib\/business/);
  // The route builds the demo prompt from the page's language alone.
  assert.match(readFileSync("app/api/session/route.ts", "utf8"), /anonymousDemoInstructions\(body\.primaryLanguage\)/);

  // The canned tools answer with this same place, week and slots: one object, not a copy.
  assert.equal(tools.DEMO_PLACE, DEMO_PLACE, "demo-tools place");
  assert.equal(tools.DEMO_PLACE_ID, DEMO_PLACE_ID, "demo-tools place id");
  assert.equal(tools.DEMO_OPEN_DAYS, DEMO_OPEN_DAYS, "demo-tools open days");
  assert.equal(tools.DEMO_SLOTS, DEMO_SLOTS, "demo-tools slots");
  const now = Date.UTC(2030, 0, 1, 5, 0); // a Tuesday, 07:00 in Asia/Jerusalem
  const answer = tools.runDemoTool("check_availability", { date: "2030-01-01" }, now, "en");
  assert.equal(answer.body.label, DEMO_PLACE.en);
  assert.deepEqual(answer.body.available_slots, [...DEMO_SLOTS]);
  assert.equal(readFileSync("lib/demo-tools.ts", "utf8").match(/notre salon du centre-ville/), null, "one definition of the place");

  console.log("ALL DEMO-PLACE TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
