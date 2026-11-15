// Who a customer e-mail greets (lib/email-greeting.ts, tamaraVP 15/11): the
// person's first name when there is one, otherwise no name; never the
// business name. Also checks that no e-mail caller hands the business name
// (displayName) or the login e-mail to a sender as the greeting name.
// Run with:  npx tsx scripts/tests/email-greeting.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { greetingName } from "../../lib/email-greeting";

// Person name present → its first name.
assert.equal(greetingName({ personName: "Dana Levi" }), "Dana");
assert.equal(greetingName({ personName: "  Dana  ", businessName: "Salon Mock" }), "Dana", "the person wins over the business");
// Only a business name → no name ("Salon Mock" used to give "Bonjour Salon,").
assert.equal(greetingName({ businessName: "Salon Mock" }), null);
assert.equal(greetingName({ personName: null, businessName: "Salon Mock" }), null);
// Empty → no name.
assert.equal(greetingName({}), null);
assert.equal(greetingName({ personName: "" }), null);
assert.equal(greetingName({ personName: "   " }), null);

// The callers: nothing passes displayName / recipientName to an e-mail
// sender any more (the account stores no person's name).
const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const email = read("lib/email.ts");
assert.doesNotMatch(email, /opts\.displayName|recipientName/, "lib/email.ts greets through greetingName only");
assert.equal((email.match(/greetingName\(\{ personName: opts\.personName \}\)/g) ?? []).length, 3, "welcome, subscription, notification test");
for (const caller of ["app/api/onboarding/provision/route.ts", "app/api/dashboard/hyp/callback/route.ts", "lib/email-test/handler.ts"]) {
  assert.doesNotMatch(read(caller), /displayName: (me|u)\.displayName|recipientName/, `${caller}: no business name as a greeting`);
}

// The welcome greeting stands alone ("Bonjour,") and the next sentence never
// opens on "Tamara", so it can't read as "Bonjour, Tamara" (tamaraVP 16/11).
assert.match(email, /const helloHtml = `\$\{helloText\}<br\/>\$\{t\("introHtmlBody"\)\}`;/);
for (const l of ["fr", "en", "he"]) {
  const w = JSON.parse(read(`messages/${l}.json`)).Email.welcome;
  assert.equal(w.introHtmlWithName, undefined, `${l}: no greeting fused with the Tamara sentence`);
  assert.equal(w.introHtmlNoName, undefined, `${l}: no greeting fused with the Tamara sentence`);
  assert.doesNotMatch(w.introHtmlBody, /^\s*Tamara/, `${l}: the sentence after the greeting doesn't open on Tamara`);
  assert.match(w.introTextNoName, /^[^—{}]+,$/, `${l}: the no-name greeting is one word and a comma`);
}

console.log("email-greeting: ok");
