// Source guard: no file under app/ imports lib/schedule.ts (the first
// customer's weekday-to-centre rule). The calendar routes resolve the place
// through lib/booking-place.ts only; lib/schedule.ts stays in the repo until
// its removal step, unreachable from any route or page.
//
// Run with:  npx tsx scripts/tests/calendar-no-schedule-import.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");
const APP = path.join(ROOT, "app");
const SCHEDULE = path.join(ROOT, "lib", "schedule");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) out.push(p);
  }
  return out;
}

// Every module specifier: import/export ... from "x", import("x"), require("x").
const SPECIFIER = /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)["']([^"']+)["']/g;

function importsSchedule(file: string, src: string): boolean {
  for (const m of src.matchAll(SPECIFIER)) {
    const spec = m[1];
    let target: string | null = null;
    if (spec.startsWith("@/")) target = path.join(ROOT, spec.slice(2));
    else if (spec.startsWith(".")) target = path.resolve(path.dirname(file), spec);
    if (target && target.replace(/\.(ts|tsx|js)$/, "").replace(/\/index$/, "") === SCHEDULE) return true;
  }
  return false;
}

// The matcher itself: every way of writing the import is caught.
const fake = path.join(APP, "api", "calendar", "x", "route.ts");
for (const src of [
  'import { centerForDate } from "@/lib/schedule";',
  "import type { Center } from '@/lib/schedule';",
  'export { labelFor } from "@/lib/schedule.ts";',
  'const s = await import("@/lib/schedule");',
  'import { x } from "../../../../lib/schedule";',
  'const s = require("../../../../lib/schedule");',
]) assert.ok(importsSchedule(fake, src), src);
for (const src of ['import { x } from "@/lib/schedule-change";', 'import { x } from "@/lib/booking-place";'])
  assert.ok(!importsSchedule(fake, src), src);

const files = walk(APP);
assert.ok(files.some((f) => f.endsWith(path.join("calendar", "book", "route.ts"))), "walk reached the calendar routes");
const offenders = files.filter((f) => importsSchedule(f, readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
assert.deepEqual(offenders, [], `files under app/ importing lib/schedule: ${offenders.join(", ")}`);

console.log(`calendar-no-schedule-import: ${files.length} files under app/, none imports lib/schedule`);
