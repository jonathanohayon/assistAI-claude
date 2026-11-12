// Truth rule of the unlisted landing pages (L3 /sales, L4 /connect): with
// the switches OFF (today), no page promises what the product does not do
// yet: no "within the minute", no 50 calls, no outbound booking or transfer.
// With the switches ON, the [SWITCH] lines appear. Also: no supplier name.
// Run with:  npx tsx scripts/tests/landings-truth.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { hits } from "../tenant-bundle-match.mjs";
import { buildSalesContent, salesMeta } from "../../lib/marketing/landings/sales";
import {
  LANDING_LOCALES,
  LANDING_SWITCHES,
  type LandingLocale,
  type LandingSwitches,
} from "../../lib/marketing/landings/switches";

const OFF: LandingSwitches = { outboundBookingEffective: false, outboundTransferEffective: false };
const ON: LandingSwitches = { outboundBookingEffective: true, outboundTransferEffective: true };

type Page = {
  name: string;
  render: (l: LandingLocale, sw: LandingSwitches) => unknown;
  meta: (l: LandingLocale) => unknown;
};
const PAGES: Page[] = [{ name: "sales", render: buildSalesContent, meta: salesMeta }];

/** Every string of a page (content object + metadata), one per line. */
function pageText(p: Page, l: LandingLocale, sw: LandingSwitches): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(p.render(l, sw));
  walk(p.meta(l));
  return out.join("\n");
}

// Speed / volume claims the product does not make.
const SPEED_VOLUME = [/dans la minute/i, /en moins d'une minute/i, /within the minute/i, /50 appels/i, /50 calls/i, /\b50\b/];

// Booking or transfer promises. Hebrew: meeting (פגיש…), calendar (יומן),
// appointments (תורים / לקבוע תור), transfer (להעביר / העברת / מעביר…).
// Chosen so that the mission line "qualifier un prospect ou annoncer une
// offre" and "Rappeler chaque demande de visite" pass.
const PROMISES = [
  /rendez-vous/i,
  /r[ée]serv/i,
  /agenda/i,
  /transf[ée]r/i,
  /\bbook/i,
  /meeting/i,
  /calendar/i,
  /transfer/i,
  /פגיש/,
  /יומן/,
  /תורים/,
  /לקבוע תור/,
  /להעביר/,
  /העברת/,
  /מעביר/,
];

// The patterns catch a booking sentence and spare the mission wording.
assert.ok(PROMISES.some((re) => re.test("Tamara réserve le rendez-vous dans l'agenda de vos vendeurs.")));
assert.ok(PROMISES.some((re) => re.test("books the meeting in your sales team's calendar")));
assert.ok(PROMISES.some((re) => re.test("וקובעת את הפגישה ביומן")));
assert.ok(!PROMISES.some((re) => re.test("Choisissez la mission : qualifier un prospect ou annoncer une offre.")));
assert.ok(!PROMISES.some((re) => re.test("Rappeler chaque demande de visite.")));

// 1. The switches are hard-coded OFF, in one place.
assert.deepEqual(LANDING_SWITCHES, OFF);
const switchesSrc = readFileSync(join(__dirname, "..", "..", "lib/marketing/landings/switches.ts"), "utf8");
assert.match(switchesSrc, /outboundBookingEffective: false,\s*outboundTransferEffective: false,/);

for (const page of PAGES) {
  for (const l of LANDING_LOCALES) {
    // 2. Switches off: no promise, no speed/volume claim, no supplier name.
    const text = pageText(page, l, OFF);
    for (const re of [...SPEED_VOLUME, ...PROMISES]) {
      const m = text.match(re);
      assert.equal(m, null, `${page.name}/${l} (switches off) must not say ${re}: …${m ? text.slice(Math.max(0, m.index! - 40), m.index! + 40) : ""}…`);
    }
    assert.equal(hits(text).size, 0, `${page.name}/${l}: no supplier or tool name (${[...hits(text).keys()].join(", ")})`);
    // The default render is the switches-off render.
    assert.equal(JSON.stringify(page.render(l, LANDING_SWITCHES)), JSON.stringify(page.render(l, OFF)));
    assert.doesNotMatch(text, /[₪€$]\s*\d|\d\s*[₪€$]/, `${page.name}/${l}: no price`);
  }
}

// 3. Switches on: the [SWITCH] lines appear (sales).
const salesOn: Record<LandingLocale, RegExp[]> = {
  fr: [/réserve le rendez-vous dans l'agenda de vos vendeurs/, /ou réserver un rendez-vous/, /les rendez-vous pris/, /transférer l'appel/],
  en: [/books the meeting in your sales team's calendar/, /or book a meeting/, /the meetings booked/, /transfer the call/],
  he: [/וקובעת את הפגישה ביומן/, /או לקבוע פגישה/, /ואילו פגישות נקבעו/, /להעביר את השיחה/],
};
for (const l of LANDING_LOCALES) {
  const on = pageText(PAGES[0], l, ON);
  for (const re of salesOn[l]) assert.match(on, re, `sales/${l} switches on: ${re}`);
  // Each switch alone brings only its own lines.
  const bookingOnly = pageText(PAGES[0], l, { outboundBookingEffective: true, outboundTransferEffective: false });
  assert.doesNotMatch(bookingOnly, salesOn[l][3]);
  const transferOnly = pageText(PAGES[0], l, { outboundBookingEffective: false, outboundTransferEffective: true });
  assert.match(transferOnly, salesOn[l][3]);
  assert.doesNotMatch(transferOnly, salesOn[l][0]);
}

// 4. The exact FR/EN copy of the brief (switches off).
const fr = pageText(PAGES[0], "fr", OFF);
const en = pageText(PAGES[0], "en", OFF);
for (const s of [
  "Aucun lead ne reste {emphasis}.",
  "sans appel",
  "Tamara appelle vos leads, les qualifie et vous dit qui est prêt. Vos vendeurs ne parlent qu'aux bons prospects.",
  "Lancer une campagne d'essai",
  "Parler à l'équipe",
  "Jusqu'à 20 appels à la fois",
  "Vos leads par fichier ou copier-coller",
  "Français, anglais, hébreu",
  "Importez vos leads",
  "Qualifier un prospect ou annoncer une offre.",
  "Tamara note sa demande et vous la retrouvez dans les résultats de la campagne.",
]) assert.ok(fr.includes(s), `fr has: ${s}`);
for (const s of [
  "No lead goes {emphasis}.",
  "uncalled",
  "Tamara calls your leads, qualifies them and tells you who is ready. Your sales team only talks to the right prospects.",
  "Start a trial campaign",
  "Talk to us",
  "Up to 20 calls at once",
  "Your leads by file or copy-paste",
  "French, English, Hebrew",
]) assert.ok(en.includes(s), `en has: ${s}`);

// 5. Footer line (VP review): every landing page has its own neutral line, never "receptionist".
{
  for (const p of PAGES)
    for (const l of ["fr", "en", "he"] as const) {
      const tag = (p.render(l, OFF) as { footerTagline?: string }).footerTagline;
      assert.ok(tag && tag.length > 0, `${p.name} ${l}: footer line set`);
      assert.doesNotMatch(tag!, /r[ée]ceptionn|receptionist|פקיד/i, `${p.name} ${l}: not the receptionist line`);
    }
  assert.equal(buildSalesContent("fr").footerTagline, "Tamara, votre agent vocal IA");
  assert.equal(buildSalesContent("en").footerTagline, "Tamara, your AI voice agent");
  const footer = readFileSync(join(new URL("../../", import.meta.url).pathname, "components/marketing/Footer.tsx"), "utf8");
  assert.match(footer, /\{tagline \?\? t\("tagline"\)\}/, "the home keeps its own line");
  assert.match(footer, /t\(tagline \? "copyrightPlain" : "copyright"/, "a landing page gets the plain copyright");
  for (const l of ["fr", "en", "he"]) {
    const f = JSON.parse(readFileSync(join(new URL("../../", import.meta.url).pathname, `messages/${l}.json`), "utf8")).Footer;
    assert.doesNotMatch(f.copyrightPlain, /r[ée]ceptionn|receptionist|פקיד/i, `${l}: copyrightPlain is neutral`);
  }
}

// 6. Door heroes (VP review): no landing page plays the home's video; /sales
// shows the live campaign card in its hero, so no showcase section repeats it.
for (const l of LANDING_LOCALES) {
  const sales = buildSalesContent(l);
  assert.equal(sales.hero?.media, "panel", `sales/${l}: the campaign card is the hero visual`);
  assert.equal("showcase" in sales, false, `sales/${l}: the campaign card does not repeat lower down`);
  for (const p of PAGES) {
    const c = p.render(l, OFF) as { hero?: { media?: string } };
    assert.notEqual(c.hero?.media, "video", `${p.name}/${l}: no video hero`);
  }
}

console.log("landings-truth: ok");
