// The onboarding fork: door × usable → first screen (lib/onboarding-route.ts).
//   1. The table: reception / sales / connect / null / invalid × usable.
//   2. "usable" is the public offer's `available` (lib/public-offer.ts), the
//      sign-up page's and the pricing cards' rule: the page reads it, and no
//      second rule exists (no env switch is read by the fork or the page).
//   3. The page forks on getAccountDoor + onboardingScreen, and renders the
//      wizard card for every "wizard" row.
// Run with:  npx tsx scripts/tests/onboarding-route.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SCREEN, doorUsable, onboardingScreen, previewHref, welcomeFormValid } from "../../lib/onboarding-route";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ── 1. The table ───────────────────────────────────────────────────────────
const NONE = { sales: false, connect: false };
const ALL = { sales: true, connect: true };
const TABLE: Array<[door: unknown, available: { sales: boolean; connect: boolean }, screen: "wizard" | "welcome"]> = [
  ["reception", NONE, "wizard"],
  ["reception", ALL, "wizard"],
  ["sales", NONE, "welcome"],
  ["sales", { sales: false, connect: true }, "welcome"],
  ["sales", { sales: true, connect: false }, "wizard"], // usable: today's wizard, unchanged (out of scope)
  ["sales", ALL, "wizard"],
  ["connect", NONE, "welcome"],
  ["connect", { sales: true, connect: false }, "welcome"],
  ["connect", { sales: false, connect: true }, "wizard"], // usable: today's wizard, unchanged (out of scope)
  ["connect", ALL, "wizard"],
  [null, NONE, "wizard"],
  [null, ALL, "wizard"],
  [undefined, NONE, "wizard"],
  ["", NONE, "wizard"],
  ["SALES", NONE, "wizard"], // the account's door is already resolved (getAccountDoor): no lenient parse here
  ["vip", NONE, "wizard"],
  [42, NONE, "wizard"],
  [{ door: "sales" }, NONE, "wizard"],
];
for (const [door, available, screen] of TABLE) {
  assert.equal(onboardingScreen(door, available), screen, `${JSON.stringify(door)} × ${JSON.stringify(available)} → ${screen}`);
}
assert.deepEqual(SCREEN, {
  reception: { usable: "wizard", notUsable: "wizard" },
  sales: { usable: "wizard", notUsable: "welcome" },
  connect: { usable: "wizard", notUsable: "welcome" },
});
assert.equal(doorUsable("reception", NONE), true, "reception is always usable");
assert.equal(doorUsable("sales", { sales: true, connect: false }), true);
assert.equal(doorUsable("connect", { sales: true, connect: false }), false);
console.log(`ok: the fork table (${TABLE.length} rows)`);

// Preview routes: the product's own dashboard page.
assert.equal(previewHref("connect"), "/dashboard/agent");
assert.equal(previewHref("sales"), "/dashboard/sales");

// Both welcome fields are required.
assert.equal(welcomeFormValid("Salon Mock", "fr"), true);
assert.equal(welcomeFormValid("  Salon Mock ", "he"), true);
assert.equal(welcomeFormValid("", "fr"), false);
assert.equal(welcomeFormValid("   ", "en"), false);
assert.equal(welcomeFormValid("Salon Mock", null), false);
assert.equal(welcomeFormValid("Salon Mock", "de"), false);
console.log("ok: preview routes, required fields");

// ── 2. One rule for "usable" ───────────────────────────────────────────────
const fork = read("lib/onboarding-route.ts");
assert.doesNotMatch(fork, /process\.env|productPurchasable|PRODUCT_ORDERS|from "\.\/public-offer"/, "the fork reads no deployment switch");
assert.doesNotMatch(fork, /^import (?!type )[^;]*public-plan-pricing/m, "only the PublicAvailability type from public-plan-pricing");
const page = read("app/[locale]/onboarding/page.tsx");
assert.match(page, /import \{ publicOffer \} from "@\/lib\/public-offer";/);
assert.match(page, /onboardingScreen\(door, publicOffer\(\)\.available\)/, "usable = publicOffer().available");
assert.doesNotMatch(page, /process\.env|productPurchasable/, "no second rule in the page");
console.log("ok: usable = publicOffer().available, no second rule");

// ── 3. The page's fork ─────────────────────────────────────────────────────
assert.match(page, /const door = await getAccountDoor\(session\.user\.id\);/);
assert.match(
  page,
  /\{welcome \?\? \(\s*<>\s*<OnboardingHeader\s+email=\{session\.user\.email\}\s+trialLabel=\{t\("trialLabel", TRIAL_COPY_VALUES\)\}\s*\/>\s*<WizardCard/,
  "every wizard row renders the header WITH its trial pill, then the wizard card",
);
assert.match(page, /productName=\{nav\(ENTRY_LABEL_KEY\[door\]\)\}/, "the product name is the DashboardNav key");
assert.match(page, /notifyRecorded=\{notifyRequested\.includes\(door\)\}/, "the notify row is read from accountProducts");
console.log("ok: the page forks on the account's door");
