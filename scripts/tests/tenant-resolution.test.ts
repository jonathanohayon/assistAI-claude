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

// ── Default-tenant fallback is REPORTED on every path (A3) ─────────────
import { resolveInboundTenantWith, tenantFallbackReport, type TenantFallback } from "../../lib/tenant-resolution";

async function fallbackTests() {
  const seen: TenantFallback[] = [];
  const L = {
    byUserId: async (u: string) => (u === "u-known" ? "tenant-U" : null),
    byPhone: async (p: string) => (p === "+15550000002" ? "tenant-A" : null),
    byDefault: async () => "first-tenant-in-db",
    accountId: (t: string) => `acct:${t}`,
    onFallback: (f: TenantFallback) => void seen.push(f),
  };
  const run = (phone: string | null, userId: string | null) =>
    resolveInboundTenantWith({ origin: "agent_config", phone, userId }, L);

  // normal paths: no report
  assert.deepEqual(await run(null, "u-known"), { resolution: "user_match", tenant: "tenant-U" });
  assert.deepEqual(await run("+15550000002", null), { resolution: "phone_match", tenant: "tenant-A" });
  // unknown number: refused, not a fallback → no report
  assert.deepEqual(await run("+15550000009", null), { resolution: "unknown_number", tenant: null });
  assert.equal(seen.length, 0);

  // userId miss → default tenant, reported
  assert.deepEqual(await run(null, "u-missing"), { resolution: "default_fallback", tenant: "first-tenant-in-db" });
  assert.deepEqual(seen.pop(), {
    origin: "agent_config", missed: "user_id_not_found", missedUserId: "u-missing", answeredBy: "acct:first-tenant-in-db",
  });
  // no identifier → default tenant, reported
  assert.deepEqual(await run(null, null), { resolution: "no_id", tenant: "first-tenant-in-db" });
  assert.equal(seen.pop()?.missed, "no_identifier");
  // empty DB: still reported, answeredBy null
  await resolveInboundTenantWith({ origin: "web", phone: null, userId: "u-missing" }, { ...L, byDefault: async () => null });
  assert.equal(seen.pop()?.answeredBy, null);

  // resolveTenantWith (calls/end, whatsapp/notify): only the no-number path reports
  const answered: Array<string | null> = [];
  const RL = { byPhone: L.byPhone, byDefault: L.byDefault, onFallback: (t: string | null) => void answered.push(t) };
  await resolveTenantWith("+15550000002", RL);
  await resolveTenantWith("+15550000009", RL);
  assert.equal(answered.length, 0);
  await resolveTenantWith(null, RL);
  await resolveTenantWith("  ", RL);
  assert.deepEqual(answered, ["first-tenant-in-db", "first-tenant-in-db"]);

  // the report: level error, deduplicated per origin, no phone number anywhere
  const r = tenantFallbackReport({ origin: "calls_end", missed: "no_identifier", answeredBy: "acct-1" });
  assert.equal(r.event.event, "tenant_fallback_used");
  assert.equal(r.event.level, "error");
  assert.equal(r.alert.key, "tenant_fallback:calls_end");
  assert.ok(!/\+?\d{8,}/.test(JSON.stringify(r)), "no phone-like number in the report");
  console.log("ALL TENANT-FALLBACK REPORT TESTS PASSED");
}
fallbackTests().catch((e) => { console.error(e); process.exit(1); });
