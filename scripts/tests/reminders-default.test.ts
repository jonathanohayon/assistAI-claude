// J-1 reminder ON by default for new tenants (lib/db/schema.ts, migration 0032).
// Run with:  npx tsx scripts/tests/reminders-default.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { agentConfigs } from "../../lib/db/schema";

assert.equal(agentConfigs.reminderEnabled.default, true);
assert.equal(agentConfigs.reminderEnabled.notNull, true);

// the migration only switches on tenants that have a calendar connected
const sql = readFileSync(new URL("../../drizzle/0032_reminders_default_on.sql", import.meta.url), "utf8");
assert.match(sql, /ALTER COLUMN "reminder_enabled" SET DEFAULT true/);
assert.match(sql, /"google_refresh_token" IS NOT NULL/);

console.log("ALL REMINDERS-DEFAULT TESTS PASSED");
