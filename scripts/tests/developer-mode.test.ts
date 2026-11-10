// Account developer-mode flag (lib/developer-mode.ts, migration 0040).
// Run with:  npx tsx scripts/tests/developer-mode.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { users } from "../../lib/db/schema";
import { parseDeveloperModeBody } from "../../lib/developer-mode";

assert.equal(users.developerMode.default, false, "off by default");
const sql = readFileSync(new URL("../../drizzle/0040_developer_mode.sql", import.meta.url), "utf8");
assert.match(sql, /ADD COLUMN IF NOT EXISTS "developer_mode" boolean DEFAULT false NOT NULL/);

assert.deepEqual(parseDeveloperModeBody({ developerMode: true }), { ok: true, value: true });
assert.deepEqual(parseDeveloperModeBody({ developerMode: false }), { ok: true, value: false });
for (const bad of [null, {}, { developerMode: "true" }, { developerMode: 1 }, "x"]) {
  assert.deepEqual(parseDeveloperModeBody(bad), { ok: false, error: "invalid_developer_mode" });
}
console.log("ALL DEVELOPER-MODE TESTS PASSED");
