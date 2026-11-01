// Pure tests for the E.164 → human-readable phone formatter.
// Run : npx tsx scripts/tests/format-phone.test.ts
import assert from "node:assert/strict";

import { formatPhone } from "../../lib/format-phone";

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

group("israeli landline groups area code and subscriber", () => {
  assert.strictEqual(formatPhone("+97223764700"), "+972 2-376-4700");
});
group("israeli mobile keeps the two-digit prefix", () => {
  assert.strictEqual(formatPhone("+972548124471"), "+972 54-812-4471");
});
group("israeli voip 07x numbers use the mobile layout", () => {
  assert.strictEqual(formatPhone("+972737654321"), "+972 73-765-4321");
});
group("french numbers are grouped in pairs", () => {
  assert.strictEqual(formatPhone("+33624881903"), "+33 6 24 88 19 03");
});
group("north american numbers use area-exchange-line", () => {
  assert.strictEqual(formatPhone("+14155550123"), "+1 415-555-0123");
});
group("unknown country codes are returned unchanged", () => {
  assert.strictEqual(formatPhone("+4930123456"), "+4930123456");
});
group("unexpected lengths are returned unchanged", () => {
  assert.strictEqual(formatPhone("+9721234"), "+9721234");
});
group("spaces and dashes in the input are tolerated", () => {
  assert.strictEqual(formatPhone("+972 2 376 4700"), "+972 2-376-4700");
});

if (failures.length) {
  console.error(`${failures.length} FAILED:`);
  failures.forEach((f) => console.error("  ✗ " + f));
  process.exit(1);
}
console.log(`ALL ${passed} TESTS PASSED`);
