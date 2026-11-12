// Guards the two test runners (scripts/run-unit-tests.mjs, `npm test`, and
// scripts/run-db-suites.sh, `npm run test:db`): discovery must not lose a
// suite, and package.json must not grow per-suite DB scripts again.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { discoverDbSuites, discoverUnitTests } from "../lib/test-discovery.mjs";

const root = path.resolve(__dirname, "..", "..");

// The 10 DB suites that had their own package.json line before test:db.
const FORMER_PACKAGE_JSON_SUITES = [
  "alert-ledger-claim",
  "agent-tokens",
  "appointment-reminders-cap",
  "client-confirm",
  "campaigns-plan-gate",
  "email-test-hardening",
  "live-test-token-limit",
  "rate-limit",
  "verification-limits",
  "whatsapp-test",
];
// Unit test files at the time the recursive runner landed.
const UNIT_TEST_FLOOR = 165;

const suites = discoverDbSuites().map((s) => s.name);

// 1. Every former package.json DB suite is still discovered.
for (const name of FORMER_PACKAGE_JSON_SUITES) {
  assert.ok(suites.includes(name), `DB suite not discovered: ${name}`);
}
console.log("ok: the 10 former package.json DB suites are discovered");

// 2. Every scripts/*-db.sh on disk is discoverable.
const onDisk = readdirSync(path.join(root, "scripts"))
  .filter((f) => f.endsWith("-db.sh"))
  .map((f) => f.slice(0, -"-db.sh".length))
  .sort();
assert.ok(onDisk.length >= 14, `expected at least 14 *-db.sh files, found ${onDisk.length}`);
assert.deepEqual([...suites].sort(), onDisk);
console.log(`ok: all ${onDisk.length} scripts/*-db.sh are discovered`);

// 3. The shell runner's --list agrees with the discovery helper.
const listed = execFileSync("bash", [path.join(root, "scripts/run-db-suites.sh"), "--list"], { encoding: "utf8" })
  .trim()
  .split("\n");
assert.deepEqual([...listed].sort(), onDisk);
console.log("ok: test:db --list prints every suite");

// 4. --only with an unknown name fails and lists the valid names.
let unknownFailed = false;
try {
  execFileSync("bash", [path.join(root, "scripts/run-db-suites.sh"), "--only", "no-such-suite"], { stdio: "pipe" });
} catch (e) {
  const err = e as { status?: number; stderr?: Buffer };
  unknownFailed = err.status === 1 && String(err.stderr).includes("rate-limit");
}
assert.ok(unknownFailed, "--only <unknown> must exit 1 and list the valid names");
console.log("ok: test:db --only <unknown> exits 1 with the valid names");

// 5. The unit runner finds every *.test.ts under scripts/tests, nested ones included.
const unit = discoverUnitTests();
assert.ok(unit.length >= UNIT_TEST_FLOOR, `unit runner found ${unit.length} files, floor is ${UNIT_TEST_FLOOR}`);
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".test.ts") ? [path.relative(root, p).split(path.sep).join("/")] : [];
  });
assert.deepEqual(unit, walk(path.join(root, "scripts/tests")).sort());
assert.ok(unit.includes("scripts/tests/test-runners.test.ts"));
console.log(`ok: unit runner discovers all ${unit.length} test files (floor ${UNIT_TEST_FLOOR}), none skipped`);

// 6. package.json: one test:db, no per-suite test:*-db line.
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
const perSuite = Object.keys(pkg.scripts).filter((k) => /^test:.+-db$/.test(k));
assert.deepEqual(perSuite, [], `per-suite DB scripts must go through test:db: ${perSuite.join(", ")}`);
assert.equal(pkg.scripts["test:db"], "bash scripts/run-db-suites.sh");
assert.equal(pkg.scripts.test, "node scripts/run-unit-tests.mjs");
console.log("ok: package.json has test:db and no test:*-db script");

// 7. Every "scripts/<x>-db.sh" hint printed or written by a unit test points at a real file.
for (const f of unit) {
  const src = readFileSync(path.join(root, f), "utf8");
  for (const m of src.matchAll(/scripts\/([a-z0-9-]+-db\.sh)/g)) {
    assert.ok(existsSync(path.join(root, "scripts", m[1])), `${f} points at missing scripts/${m[1]}`);
  }
}
console.log("ok: every scripts/*-db.sh hint in the unit tests exists");
