// Unit tests for lib/neutral-seed.ts — the persona a NEW account starts with.
// Run with:  npx tsx scripts/tests/neutral-seed.test.ts
import assert from "node:assert/strict";

import { DEFAULT_AGENT_NAME, neutralSeed, seedForNewAccount } from "../../lib/neutral-seed";
import { FIRST_CUSTOMER_FACTS } from "./first-customer-facts";
import { assertScanRead, scanSources } from "./helpers/source-scan";

const LANGS = ["fr", "he", "en"] as const;

// (c) No business fact of any customer, in any language.
const FACTS = FIRST_CUSTOMER_FACTS;
for (const l of LANGS) {
  const s = neutralSeed(l);
  for (const t of [s.instructions, s.greeting]) {
    assert.doesNotMatch(t, FACTS, `${l}: ${t.slice(0, 80)}`);
    assert.ok(t.includes(DEFAULT_AGENT_NAME), `${l}: names the agent`);
  }
  assert.equal(s.primaryLanguage, l);
  assert.ok(s.instructions.length < 900, `${l}: short`);
}
// It says to take a message when it doesn't know.
assert.match(neutralSeed("fr").instructions, /prendre un message/);
assert.match(neutralSeed("en").instructions, /take a message/);
assert.match(neutralSeed("he").instructions, /הודעה/);
// Unknown locale → French (the column's default).
assert.equal(neutralSeed("de").primaryLanguage, "fr");
assert.equal(neutralSeed(null).instructions, neutralSeed("fr").instructions);

// (b) The admin's per-plan template and greeting still win.
const t = seedForNewAccount("global", "en", { global: "  ADMIN TEMPLATE  " }, { global: "ADMIN GREETING" });
assert.deepEqual(t, { instructions: "ADMIN TEMPLATE", greeting: "ADMIN GREETING", primaryLanguage: "en" });
const other = seedForNewAccount("premium", "he", { global: "ADMIN TEMPLATE" }, {});
assert.equal(other.instructions, neutralSeed("he").instructions, "another plan's template doesn't apply");
assert.equal(seedForNewAccount("global", "fr", { global: "   " }, {}).instructions, neutralSeed("fr").instructions, "blank template → neutral");

// (a) Two importers only: account CREATION (inserts only), and the internal
//     reset endpoint (INTERNAL_SECRET-gated ops: "apply what a new account
//     gets"). Nothing else may write the neutral seed onto an account.
// Import lines of any form (alias or relative path), searched in Node: no shell quoting.
const IMPORT_RE = /\bfrom\s+["'][^"']*neutral-seed["']|\bimport\(\s*["'][^"']*neutral-seed["']\s*\)/;
// Resolved from this file's location (cwd-independent), and every file is read.
const scan = scanSources(["app", "lib", "scripts", "auth.ts"], { ext: /\.(ts|tsx|mjs)$/, skipDirs: ["scripts/tests"] });
// The scan must have read the real tree, or "exactly two importers" proves nothing.
assertScanRead(scan, "neutral-seed importers", {
  minFiles: 100,
  minPerRoot: 5,
  sentinels: [
    "lib/neutral-seed.ts",
    "lib/auth/provision-tenant.ts",
    "app/api/admin/internal-apply-default-prompt/route.ts",
    "auth.ts",
    "scripts/migrate.mjs", // a scripts/* file outside scripts/tests: the exclusion is narrow
  ],
  absent: ["scripts/tests"],
});
const importers = scan.files.filter((f) => f !== "lib/neutral-seed.ts" && IMPORT_RE.test(scan.text.get(f)!));
assert.deepEqual(importers, ["app/api/admin/internal-apply-default-prompt/route.ts", "lib/auth/provision-tenant.ts"]);
// The search catches every import form (probe on strings, not files).
for (const line of [`import { x } from "@/lib/neutral-seed";`, `import { x } from "../neutral-seed";`, `import { x } from '../../lib/neutral-seed';`, `await import("../neutral-seed")`])
  assert.match(line, IMPORT_RE, line);
assert.doesNotMatch("// see lib/neutral-seed.ts", IMPORT_RE, "a comment isn't an import");
const provision = scan.text.get("lib/auth/provision-tenant.ts")!;
assert.doesNotMatch(provision, /\.update\(agentConfigs\)/, "provisioning never updates an existing agent config");
const reset = scan.text.get("app/api/admin/internal-apply-default-prompt/route.ts")!;
assert.match(reset, /const auth = requireInternalSecret\(req\);\s*if \(!auth\.ok\) return auth\.response;/, "the reset is INTERNAL_SECRET-gated");

console.log("ALL NEUTRAL-SEED TESTS PASSED");
