// Never show what can't be used: no "coming soon" placeholder tile in the
// dashboard grid, its public preview or the admin shell.
// Run with:  npx tsx scripts/tests/no-soon-tiles.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
for (const f of [
  "app/[locale]/dashboard/config-form.tsx",
  "app/[locale]/dashboard/config/shared-ui.tsx",
  "app/[locale]/dashboard-preview/wow/client.tsx",
  "app/admin/admin-shell.tsx",
]) {
  assert.doesNotMatch(readFileSync(join(ROOT, f), "utf8"), /\bAddTile\b|>\s*Bientôt\s*</, f);
}

console.log("ALL NO-SOON-TILES TESTS PASSED");
