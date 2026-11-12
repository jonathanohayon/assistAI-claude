// lib/demo-place.ts: the home demo's one fictional place and its fact sheet,
// and the guards that keep a stored account's business out of the demo
// prompt. The DB-backed end-to-end check is scripts/demo-sheet-db.sh.
// Run with:  npx tsx scripts/tests/demo-place.test.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { anonymousDemoInstructions } from "../../lib/demo-instructions";
import {
  DEMO_CLOSE_TIME,
  DEMO_FORBIDDEN_PLACES,
  DEMO_LANGS,
  DEMO_OPEN_DAYS,
  DEMO_OPEN_TIME,
  DEMO_PLACE,
  DEMO_PLACE_ID,
  DEMO_SERVICES,
  DEMO_SLOTS,
  demoLang,
  demoPersonaInstructions,
  demoSheetBlock,
} from "../../lib/demo-place";
import { CENTERS, labelFor } from "../../lib/schedule";

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
    for (const l of DEMO_LANGS) assert.ok(s.name[l].trim() && s.price[l] > 0, `${s.name.fr} ${l}`);
  }

  // The forbidden list covers every lib/schedule centre label.
  for (const c of CENTERS) assert.match(labelFor(c), DEMO_FORBIDDEN_PLACES, c);
  for (const town of ["Jerusalem", "Netanya", "ירושלים", "אשדוד", "נתניה"]) assert.match(town, DEMO_FORBIDDEN_PLACES);

  // The sheet, per language: the place, the services, the right week, no real place.
  for (const l of DEMO_LANGS) {
    const sheet = demoSheetBlock(l);
    assert.ok(sheet.includes(`« ${DEMO_PLACE[l]} »`), `${l}: place`);
    for (const s of DEMO_SERVICES) assert.ok(sheet.includes(s.name[l]), `${l}: ${s.name[l]}`);
    assert.match(sheet, /samedi : fermé/);
    assert.doesNotMatch(sheet, DEMO_FORBIDDEN_PLACES);
    assert.match(sheet, /seule cette fiche fait foi/);
  }
  assert.match(demoSheetBlock("he"), /dimanche : 10:00–18:00/);
  assert.match(demoSheetBlock("he"), /vendredi : fermé/);
  assert.match(demoSheetBlock("fr"), /dimanche : fermé/);
  assert.match(demoSheetBlock("en"), /vendredi : 10:00–18:00/);
  assert.equal(demoSheetBlock("xx"), demoSheetBlock("fr"));

  // Stored persona: untouched unless a line names a real place, then that line goes.
  assert.equal(demoPersonaInstructions(null), "");
  assert.equal(demoPersonaInstructions("  Ton chaleureux.\n\nVouvoie.  "), "  Ton chaleureux.\n\nVouvoie.  ");
  assert.equal(
    demoPersonaInstructions("Ton chaleureux.\nNous sommes à Jérusalem le mardi.\nVouvoie.\nסניף אשדוד"),
    "Ton chaleureux.\nVouvoie.",
  );

  // No demo account: the built-in persona carries the sheet too.
  for (const l of DEMO_LANGS) {
    const prompt = anonymousDemoInstructions(null, l);
    assert.ok(prompt.includes(demoSheetBlock(l)), `fallback ${l}: sheet`);
    assert.doesNotMatch(prompt, DEMO_FORBIDDEN_PLACES);
  }

  // The demo loader never reads the stored business, nor renders a business block.
  const loader = readFileSync("lib/demo-agent.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(loader, /agentConfigs\.business|renderBusinessPromptBlock|sanitizeBusinessConfig|@\/lib\/business/);
  assert.match(loader, /demoSheetBlock\(langParam\)/);
  assert.match(loader, /demoPersonaInstructions\(cfg\.instructions\)/);

  // Once the canned tools (lib/demo-tools.ts, PR #322) are on this tree, they
  // must answer with this same place, week and slots.
  if (existsSync("lib/demo-tools.ts")) {
    // A variable specifier: the module does not exist on main yet.
    const spec = "../../lib/demo-tools";
    const tools = (await import(spec)) as Record<string, unknown>;
    assert.deepEqual(tools.DEMO_PLACE, DEMO_PLACE, "demo-tools place");
    assert.equal(tools.DEMO_PLACE_ID, DEMO_PLACE_ID, "demo-tools place id");
    assert.deepEqual(tools.DEMO_OPEN_DAYS, DEMO_OPEN_DAYS, "demo-tools open days");
    assert.deepEqual(tools.DEMO_SLOTS, DEMO_SLOTS, "demo-tools slots");
  }

  console.log("ALL DEMO-PLACE TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
