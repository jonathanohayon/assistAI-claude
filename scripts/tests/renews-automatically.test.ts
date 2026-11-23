// renewsAutomatically() must say NO until the Phase D renewal job exists:
// cron/billing expires every active account at paidUntil and never charges a
// saved card. Run with:  npx tsx scripts/tests/renews-automatically.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PHASE_D_RENEWAL_JOB, renewsAutomatically } from "../../lib/billing/auto-renew";

// 1) false for every combination, whatever HYP_TOKENS_ENABLED says
const savedFlag = process.env.HYP_TOKENS_ENABLED;
for (const flag of ["1", undefined]) {
  if (flag === undefined) delete process.env.HYP_TOKENS_ENABLED;
  else process.env.HYP_TOKENS_ENABLED = flag;
  for (const subscriptionStatus of ["active", "expired", "trialing"]) {
    for (const autoRenew of [true, false]) {
      for (const hypToken of ["tok_mock_123", null]) {
        assert.equal(
          renewsAutomatically({ subscriptionStatus, autoRenew, hypToken }),
          false,
          `expected false for ${JSON.stringify({ flag, subscriptionStatus, autoRenew, hypToken })}`,
        );
      }
    }
  }
}
if (savedFlag === undefined) delete process.env.HYP_TOKENS_ENABLED;
else process.env.HYP_TOKENS_ENABLED = savedFlag;

// 2) false for null / undefined / empty
assert.equal(renewsAutomatically(null), false);
assert.equal(renewsAutomatically(undefined), false);
assert.equal(renewsAutomatically({}), false);

// 3) source guards: the gate is a plain false constant, and cron/billing still has
// no token-renewal path. If Phase D ships, this fails until the helper is revisited.
assert.equal(PHASE_D_RENEWAL_JOB, false);
const helperSrc = readFileSync(new URL("../../lib/billing/auto-renew.ts", import.meta.url), "utf8");
assert.match(helperSrc, /export const PHASE_D_RENEWAL_JOB = false;/);
assert.doesNotMatch(helperSrc, /process\.env|^\s*import\s/m, "helper must stay pure (no env read, no imports)");

const cronSrc = readFileSync(new URL("../../app/api/cron/billing/route.ts", import.meta.url), "utf8");
const code = cronSrc
  .split("\n")
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
  .join("\n");
assert.doesNotMatch(code, /hypToken|HYP_TOKENS_ENABLED/, "cron/billing now reads the saved token — revisit renewsAutomatically()");
assert.doesNotMatch(code, /charge\w*\s*\(|@\/lib\/hyp/i, "cron/billing now charges — revisit renewsAutomatically()");
assert.match(cronSrc, /subscriptionStatus: "expired"/, "cron/billing Phase 2 should still expire accounts at paidUntil");

console.log("renews-automatically: ok");
