// inheritAdminGlobals is admin-only (product change 11/11), the 3-case rule:
// other fields pass; an unchanged re-send passes; a tenant change → 403.
// Existing values are kept (no migration). Run with:  npx tsx scripts/tests/admin-gates.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { inheritAdminGlobalsWrite } from "../../lib/admin-gates";

for (const current of [true, false]) {
  // 1) a tenant saving OTHER fields (no inheritAdminGlobals in the body) → passes, nothing written
  assert.deepEqual(inheritAdminGlobalsWrite({}, current, false), { ok: true, value: undefined });
  // 2) a tenant re-sending the value UNCHANGED → passes (the screen sends the whole form)
  assert.deepEqual(inheritAdminGlobalsWrite({ inheritAdminGlobals: current }, current, false), { ok: true, value: current });
  // 3) a tenant CHANGING it → 403 naming the field
  assert.deepEqual(inheritAdminGlobalsWrite({ inheritAdminGlobals: !current }, current, false), {
    ok: false,
    error: "admin_only",
    fields: ["inheritAdminGlobals"],
  });
  // admins can change it
  assert.deepEqual(inheritAdminGlobalsWrite({ inheritAdminGlobals: !current }, current, true), { ok: true, value: !current });
}
// a tenant who turned inheritance OFF in May stays off: re-sending false passes
assert.deepEqual(inheritAdminGlobalsWrite({ inheritAdminGlobals: false }, false, false), { ok: true, value: false });

// the tenant route enforces it on the server (not only the screen)
const route = readFileSync(new URL("../../app/api/dashboard/config/route.ts", import.meta.url), "utf8");
assert.match(route, /inheritAdminGlobalsWrite\(body, current\.inheritAdminGlobals !== false, isAdmin\)/);
assert.doesNotMatch(route, /updates\.inheritAdminGlobals = Boolean\(body\.inheritAdminGlobals\)/);

console.log("ALL ADMIN-GATES TESTS PASSED");
