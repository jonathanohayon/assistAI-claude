// Plan copy must not restate numbers that lib/plans.ts owns.
// Run : npx tsx scripts/tests/plan-copy.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fillPlanFeatures, PLANS } from "../../lib/plans";

let passed = 0;
const failures: string[] = [];
const group = (label: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`[${label}] ${e instanceof Error ? e.message : e}`);
  }
};

const LOCALES = ["fr", "en", "he"] as const;
const messages = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(`messages/${l}.json`, "utf8"))]),
);

group("fillPlanFeatures replaces every {minutes}", () => {
  const plan = { minutesIncluded: 500 };
  assert.deepStrictEqual(fillPlanFeatures(plan, ["{minutes} min", "x", "{minutes}/{minutes}"]), [
    "500 min",
    "x",
    "500/500",
  ]);
});

for (const locale of LOCALES) {
  for (const plan of PLANS) {
    const features: string[] = messages[locale].Plans?.[plan.key]?.features ?? [];
    group(`${locale}/${plan.key}: included minutes come from PLANS`, () => {
      assert.ok(features.some((f) => f.includes("{minutes}")), "no {minutes} placeholder");
      for (const f of features) {
        assert.ok(!/\b\d{3,4}\s*(minutes|min|דקות)/.test(f), `hard-coded minutes: "${f}"`);
      }
    });
  }
  group(`${locale}: no euro amount hard-coded in Plans or FAQ copy`, () => {
    const copy = JSON.stringify([messages[locale].Plans, messages[locale].FAQ]);
    assert.ok(!/\d\s?€|€\s?\d/.test(copy), "found a euro amount");
  });
}

group("fallback copy in lib/plans.ts uses the placeholder too", () => {
  for (const plan of PLANS) {
    assert.ok(plan.features.some((f) => f.includes("{minutes}")), `${plan.key} fallback`);
  }
});

console.log(`plan-copy: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error("  ✗", f);
  process.exit(1);
}
