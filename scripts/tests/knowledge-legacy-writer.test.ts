// Knowledge S6a: the deprecated inbound `knowledge` array is no longer
// written by any web code path. Run with:  npx tsx scripts/tests/knowledge-legacy-writer.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

// the tenant config route refuses it explicitly (never a silent ignore)
const route = readFileSync(new URL("../../app/api/dashboard/config/route.ts", import.meta.url), "utf8");
assert.match(route, /if \("knowledge" in body\) \{\n\s+return NextResponse\.json\(\n\s+\{ error: "knowledge_field_removed"/);
assert.doesNotMatch(route, /updates as any\)\.knowledge/, "no write of the column left in the route");

// no code under app/ or lib/ writes agent_configs.knowledge any more
const root = new URL("../../", import.meta.url).pathname;
const hits = execSync(
  `git grep -nE "\\\\.knowledge = |knowledge: sql|agentConfigs\\\\.knowledge" -- app lib || true`,
  { cwd: root, encoding: "utf8" },
).trim();
assert.equal(hits, "", `unexpected writer/reader reference:\n${hits}`);

console.log("ALL KNOWLEDGE-LEGACY-WRITER TESTS PASSED");
