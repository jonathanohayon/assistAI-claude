// Call-type classifier in FR / HE / EN (lib/call-type.ts). Mock content only.
// Run with:  npx tsx scripts/tests/call-type.test.ts

import assert from "node:assert/strict";

import { inferCallType } from "../../lib/call-type";

const cases: Array<[string, string, ReturnType<typeof inferCallType>]> = [
  // French (behaviour unchanged)
  ["fr", "La cliente veut annuler son RDV de mardi", "Annulation"],
  ["fr", "Le client souhaite déplacer son rendez-vous à jeudi", "Modification"],
  ["fr", "Dana laisse un message : merci de la rappeler", "Message"],
  ["fr", "RDV pris pour mardi 10h, coupe", "RDV"],
  ["fr", "Question sur les tarifs", "Info"],
  // Hebrew
  ["he", "הלקוחה ביקשה לבטל את התור של יום שלישי", "Annulation"],
  ["he", "הלקוח רוצה להזיז את התור ליום חמישי", "Modification"],
  ["he", "דנה השאירה הודעה ומבקשת שיחזרו אליה", "Message"],
  ["he", "נקבע תור ליום שלישי בעשר, תספורת", "RDV"],
  ["he", "שאלה על המחירים", "Info"],
  // "בתור" (= "as a") must not count as a booking
  ["he", "התקשרה בתור לקוחה חדשה לשאול על שעות הפתיחה", "Info"],
  // English
  ["en", "The client asked to cancel Tuesday's appointment", "Annulation"],
  ["en", "Caller wants to reschedule to Thursday", "Modification"],
  ["en", "Dana left a message and asked us to call her back", "Message"],
  ["en", "Booked Tuesday 10am, haircut", "RDV"],
  ["en", "Question about prices", "Info"],
  // "j'ai" style false friends and "booking" inside other words
  ["en", "Asked about the bookshelf decor", "Info"],
];

for (const [lang, summary, expected] of cases) {
  assert.equal(inferCallType(summary, []), expected, `${lang}: ${summary}`);
}

// transcript text counts too (tool names included)
assert.equal(inferCallType("", ["assistant: cancel_appointment ok"]), "Annulation");
assert.equal(inferCallType("", ["user: אפשר לקבוע תור למחר?"]), "RDV");

console.log(`call-type: ${cases.length + 2} passed`);
