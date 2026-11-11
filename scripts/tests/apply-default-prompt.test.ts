// The internal reset endpoint (/api/admin/internal-apply-default-prompt)
// applies what a NEW account gets (seedForNewAccount), never the first
// customer's persona. Pure checks; the endpoint is not run (it rewrites a
// tenant's agent). Mock data only.
// Run with:  npx tsx scripts/tests/apply-default-prompt.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { seedForNewAccount } from "../../lib/neutral-seed";
import { PLANS } from "../../lib/plans";

import { FIRST_CUSTOMER_FACTS } from "./first-customer-facts";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const ROUTE = "app/api/admin/internal-apply-default-prompt/route.ts";

// 1. The route uses the new-account seed with the admin's per-plan texts, and nothing else.
{
  const src = read(ROUTE);
  assert.match(src, /seedForNewAccount\(plan, resolvedUser\.locale, templatesByPlan, greetingsByPlan\)/);
  assert.match(src, /getOnboardingTemplateByPlan\(\), getOnboardingGreetingByPlan\(\)/);
  assert.doesNotMatch(src, /initial-config/);
  assert.doesNotMatch(src, FIRST_CUSTOMER_FACTS, "no first-customer fact in the route");
}

// 2. The first customer's persona file is gone, and nothing imports it.
{
  assert.ok(!existsSync(join(ROOT, "lib/initial-config.ts")));
  for (const f of [ROUTE, "lib/settings.ts", "lib/auth/provision-tenant.ts", "app/admin/global-instructions-form.tsx"])
    assert.doesNotMatch(read(f), /initial-config|Johana/, f);
}

// 3. What the reset applies with no admin text: no first-customer fact, any plan, any language.
for (const p of PLANS)
  for (const locale of ["fr", "he", "en", null]) {
    const s = seedForNewAccount(p.key, locale, {}, {});
    for (const t of [s.instructions, s.greeting]) assert.doesNotMatch(t, FIRST_CUSTOMER_FACTS, `${p.key}/${locale}`);
  }
// …and the admin's per-plan texts still win, as at signup.
assert.equal(seedForNewAccount(PLANS[0].key, "fr", { [PLANS[0].key]: "Mock template" }, { [PLANS[0].key]: "Mock greeting" }).instructions, "Mock template");

console.log("ALL APPLY-DEFAULT-PROMPT TESTS PASSED");
