// "Call us" line in client WhatsApp messages (lib/whatsapp-call-line.ts).
// Mock numbers only. Run with:  npx tsx scripts/tests/whatsapp-call-line.test.ts

import assert from "node:assert/strict";

import { callUsLine, TEMPLATE_VAR_MAX, withCallUsLine } from "../../lib/whatsapp-call-line";
import { reminderText } from "../../lib/reminders";

const N = "+97220000000";
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);

// per language
assert.equal(callUsLine("fr", N), "📞 Une question ? Appelez-nous : +97220000000");
assert.equal(callUsLine("en", N), "📞 Questions? Call us: +97220000000");
assert.equal(callUsLine("he", N), `📞 יש שאלה? התקשרו אלינו: ${LRI}+97220000000${PDI}`);
assert.equal(callUsLine("xx", N), callUsLine("fr", N), "unknown language → French");

// no / invalid number → no line, text unchanged
assert.equal(withCallUsLine("Bonjour", "fr", null), "Bonjour");
assert.equal(withCallUsLine("Bonjour", "fr", ""), "Bonjour");
assert.equal(withCallUsLine("Bonjour", "fr", "0500000000"), "Bonjour", "not E.164 → no line");
assert.equal(callUsLine("fr", "+972"), "");

// appended after a blank line
assert.equal(withCallUsLine("Bonjour Dana", "fr", N), "Bonjour Dana\n\n📞 Une question ? Appelez-nous : +97220000000");

// the J-1 reminder in all 3 languages
for (const lang of ["fr", "he", "en"] as const) {
  const t = withCallUsLine(reminderText(lang, { name: "Dana", dateLabel: "mardi 10 novembre", time: "10:00", center: "" }), lang, N);
  assert.ok(t.endsWith(callUsLine(lang, N)), lang);
  assert.ok(t.length <= TEMPLATE_VAR_MAX, lang);
}

// 1000-char clamp: the main text is trimmed, the line is never cut
{
  const long = "x".repeat(1200);
  for (const lang of ["fr", "he", "en"]) {
    const t = withCallUsLine(long, lang, N);
    assert.equal(t.length <= TEMPLATE_VAR_MAX, true, `${lang} length ${t.length}`);
    assert.ok(t.endsWith(callUsLine(lang, N)), `${lang} line intact`);
    assert.ok(t.includes("…\n\n📞"), `${lang} trimmed text marked`);
  }
  // exactly at the limit: untouched
  const line = callUsLine("en", N);
  const fit = "y".repeat(TEMPLATE_VAR_MAX - line.length - 2);
  assert.equal(withCallUsLine(fit, "en", N), `${fit}\n\n${line}`);
  assert.equal(withCallUsLine(fit, "en", N).length, TEMPLATE_VAR_MAX);
  // no number: old behaviour (plain clamp)
  assert.equal(withCallUsLine(long, "fr", null).length, TEMPLATE_VAR_MAX);
}

console.log("ALL WHATSAPP-CALL-LINE TESTS PASSED");
