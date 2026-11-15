// Public pages show only obviously fictional phone numbers (all zeros after
// the operator digit), never realistic ones that may belong to someone. The
// one real number (our support line) lives only in SupportFab.tsx.
// Run with:  npx tsx scripts/tests/marketing-mock-numbers.test.ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const DIR = join(ROOT, "components/marketing");
// A phone-looking run: + then 10–14 digits, spaces allowed between groups.
const PHONE = /\+\d[\d ]{8,16}\d/g;
// Fictional: after the country code and the first digit, only zeros and at most one final non-zero digit.
const isMock = (raw: string) => /^\+(972|33)\s?\d[\s0]*\d?$/.test(raw.trim());

const offenders: string[] = [];
for (const f of readdirSync(DIR, { recursive: true }) as string[]) {
  if (!/\.tsx?$/.test(f) || f.endsWith("SupportFab.tsx")) continue;
  const src = readFileSync(join(DIR, f), "utf8");
  for (const m of src.match(PHONE) ?? []) if (!isMock(m)) offenders.push(`${f}: ${m}`);
}
assert.deepEqual(offenders, [], "realistic phone numbers on public pages");
assert.ok(isMock("+972 50 000 0001") && isMock("+33 6 00 00 00 00") && !isMock("+972 54 812 4471"));

console.log("marketing-mock-numbers: ok");
