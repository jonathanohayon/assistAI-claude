// `npm test`: runs every scripts/tests/**/*.test.ts with tsx, one at a time,
// in sorted order, and stops on the first failure. DB suites are not run here:
// each DB test file skips itself unless its own env var is set (see test:db).
import { spawnSync } from "node:child_process";
import { discoverUnitTests } from "./lib/test-discovery.mjs";

const files = discoverUnitTests();
for (const f of files) {
  console.log(`› ${f}`);
  const r = spawnSync("tsx", [f], { stdio: "inherit" });
  if (r.error) {
    console.error(r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log(`\n${files.length} test files passed`);
