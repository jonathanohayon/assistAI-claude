// What a tenant's browser receives: no message names a tool (next-intl
// ships the whole catalogue), and the plan's shared directives are computed
// for admins only. Mock data only.
// Run with:  npx tsx scripts/tests/tenant-leaks.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TOOL_NAMES } from "../tenant-bundle-match.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const names = new RegExp(`\\b(?:${(TOOL_NAMES as string[]).join("|")})\\b`);

for (const l of ["fr", "en", "he"]) assert.doesNotMatch(read(`messages/${l}.json`), names, `${l}: a message names a tool`);

// The tenant dashboard passes the shared directives to admins only.
assert.match(read("app/[locale]/dashboard/page.tsx"), /const adminInheritablePreview = isAdmin\s*\?/);

// The tenant-facing box listing the technical tool names is gone.
assert.doesNotMatch(read("app/[locale]/dashboard/config/persona-panel.tsx"), /ToolsAvailableHint/);

console.log("ALL TENANT-LEAKS TESTS PASSED");
