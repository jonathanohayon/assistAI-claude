// Unit tests for lib/tenant-resolution.ts.
// Run with:  npx tsx scripts/tests/tenant-resolution.test.ts

import assert from "node:assert/strict";

import { decideTenantResolution, resolveTenantWith } from "../../lib/tenant-resolution";

// THE BUG: an unknown dialed number is refused, never served the default tenant
assert.equal(
  decideTenantResolution({ phone: "+97230000000", userId: null, matched: false }),
  "unknown_number",
);

// a known dialed number routes to its tenant
assert.equal(
  decideTenantResolution({ phone: "+97220000000", userId: null, matched: true }),
  "phone_match",
);

// web LiveTest (userId) keeps its behaviour, matched or not
assert.equal(decideTenantResolution({ phone: null, userId: "u1", matched: true }), "user_match");
assert.equal(decideTenantResolution({ phone: null, userId: "u1", matched: false }), "default_fallback");

// userId wins over phone, as before
assert.equal(decideTenantResolution({ phone: "+972", userId: "u1", matched: true }), "user_match");

// no identifier at all keeps the default path
assert.equal(decideTenantResolution({ phone: null, userId: null, matched: false }), "no_id");

console.log("ALL TENANT-RESOLUTION TESTS PASSED");

// ── resolveTenantWith: /api/calls/end and /api/whatsapp/notify ────────────
async function resolverTests() {
  const calls: string[] = [];
  const lookups = {
    byPhone: async (p: string) => {
      calls.push(`phone:${p}`);
      return p === "+15550000002" ? "tenant-A" : null;
    },
    byDefault: async () => {
      calls.push("default");
      return "first-tenant-in-db";
    },
  };

  // known dialed number -> its tenant
  assert.equal(await resolveTenantWith("+15550000002", lookups), "tenant-A");

  // THE BUG: unknown dialed number -> null, never the first tenant in the DB
  calls.length = 0;
  assert.equal(await resolveTenantWith("+15550000009", lookups), null);
  assert.deepEqual(calls, ["phone:+15550000009"]);

  // no number at all (legacy callers) -> default tenant
  assert.equal(await resolveTenantWith(null, lookups), "first-tenant-in-db");
  assert.equal(await resolveTenantWith("   ", lookups), "first-tenant-in-db");

  // the number is trimmed before lookup
  assert.equal(await resolveTenantWith(" +15550000002 ", lookups), "tenant-A");

  console.log("ALL TENANT-RESOLVER TESTS PASSED");
}
resolverTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
