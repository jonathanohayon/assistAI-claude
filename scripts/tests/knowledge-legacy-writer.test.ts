// Knowledge S6a: the deprecated inbound `knowledge` array is no longer
// written by any web code path. Run with:  npx tsx scripts/tests/knowledge-legacy-writer.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

// the tenant config route refuses it explicitly (never a silent ignore)
const route = readFileSync(new URL("../../app/api/dashboard/config/route.ts", import.meta.url), "utf8");
assert.match(route, /if \("knowledge" in body\) \{\n\s+return NextResponse\.json\(\n\s+\{ error: "knowledge_field_removed"/);
assert.doesNotMatch(route, /updates as any\)\.knowledge/, "no write of the column left in the route");

// no code under app/ or lib/ writes agent_configs.knowledge any more, with ONE
// exception: the admin company-sheet reset (lib/company-sheet-reset.ts) CLEARS
// it (to []) and its undo restores the exact stored snapshot. It never writes
// any other value (checked below).
const root = new URL("../../", import.meta.url).pathname;
const RESET = "lib/company-sheet-reset.ts";
const resetSrc = readFileSync(new URL(`../../${RESET}`, import.meta.url), "utf8");
const resetWrites = [...resetSrc.matchAll(/knowledge = ([^,\n]+)/g)].map((m) => m[1].trim());
assert.deepEqual(resetWrites.sort(), ["r.applied->'knowledge'", "r.applied->'knowledge' AS knowledge", "r.previous->'knowledge'"], `${RESET}: only the cleared value / the exact snapshot`);
assert.match(readFileSync(new URL("../../lib/company-sheet-reset-rules.ts", import.meta.url), "utf8"), /return \{ business: structuredClone\(DEFAULT_BUSINESS\), knowledge: \[\] \};/, "applied knowledge = []");
const hits = execSync(
  `git grep -nE "\\\\.knowledge = |knowledge: sql|agentConfigs\\\\.knowledge" -- app lib ':!${RESET}' || true`,
  { cwd: root, encoding: "utf8" },
).trim();
assert.equal(hits, "", `unexpected writer/reader reference:\n${hits}`);

console.log("ALL KNOWLEDGE-LEGACY-WRITER TESTS PASSED");
