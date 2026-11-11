// The dev seed (npm run db:seed) must carry a fictional business, never the
// first customer's facts. Run with:  npx tsx scripts/tests/dev-seed-neutral.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { FIRST_CUSTOMER_FACTS } from "./first-customer-facts";

const seed = readFileSync("lib/db/seed.ts", "utf8");

// No fact of the first customer anywhere in the seed file.
const hit = seed.match(FIRST_CUSTOMER_FACTS);
assert.equal(hit, null, `dev seed contains a first-customer fact: ${hit?.[0]}`);

// It still seeds a (fictional) business: persona + greeting both present.
assert.match(seed, /const INITIAL_INSTRUCTIONS = `/);
assert.match(seed, /const INITIAL_GREETING =/);
assert.match(seed, /Demo Salon/, "uses the fictional demo business");

// Contact data is obviously fake (reserved 555 number, example.com).
for (const phone of seed.match(/\+\d{8,15}/g) ?? [])
  assert.match(phone, /^\+1555/, `non-fictional phone number: ${phone}`);
for (const email of seed.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [])
  assert.match(email, /@example\.(com|org|net)$/, `non-fictional email: ${email}`);

// The seed must not import the neutral persona (neutral-seed has exactly two importers).
assert.doesNotMatch(seed, /neutral-seed/);

// The regex itself still catches the facts this test guards against.
for (const fact of ["Prestige", "Johana", "Jérusalem", "Ashdod", "Natanya", "Lundi", "Mercredi", "60 minutes", "Épilation", "Soins de la peau"])
  assert.match(fact, FIRST_CUSTOMER_FACTS, fact);

console.log("dev-seed-neutral: ok");
