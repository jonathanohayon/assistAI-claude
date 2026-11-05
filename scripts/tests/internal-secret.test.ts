// requireInternalSecret / safeEqual (lib/api/auth-guards.ts) and the debug
// routes, which now take the secret from the header only.
// Run with:  npx tsx scripts/tests/internal-secret.test.ts

import assert from "node:assert/strict";

import { NextRequest } from "next/server";

process.env.INTERNAL_SECRET = "test-internal-secret";
delete process.env.DATABASE_URL;

async function main() {
  const { requireInternalSecret, safeEqual } = await import("../../lib/api/auth-guards");

  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false); // different lengths, no throw
  assert.equal(safeEqual("", ""), true);

  const req = (h?: Record<string, string>, q = "") =>
    new NextRequest(`https://example.test/api/x${q}`, { headers: h });
  assert.equal(requireInternalSecret(req({ "x-internal-secret": "test-internal-secret" })).ok, true);
  assert.equal(requireInternalSecret(req({ "x-internal-secret": "wrong" })).ok, false);
  assert.equal(requireInternalSecret(req()).ok, false);

  // no INTERNAL_SECRET configured: everything is refused, even an empty header
  const saved = process.env.INTERNAL_SECRET;
  process.env.INTERNAL_SECRET = "";
  assert.equal(requireInternalSecret(req({ "x-internal-secret": "" })).ok, false);
  process.env.INTERNAL_SECRET = saved;

  // debug routes: the old ?token= query string no longer authenticates
  for (const path of ["../../app/api/debug/tenants/route", "../../app/api/debug/latest-call/route"]) {
    const { GET } = await import(path);
    const viaQuery = await GET(req(undefined, "?token=test-internal-secret"));
    assert.equal(viaQuery.status, 401, `${path}: ?token= must be refused`);
    const wrong = await GET(req({ "x-internal-secret": "wrong" }));
    assert.equal(wrong.status, 401);
  }

  // worker → web campaign progress webhook (live console)
  {
    const { POST } = await import("../../app/api/agent/campaign-progress/route");
    const res = await POST(req({ "x-internal-secret": "wrong" }));
    assert.equal(res.status, 401, "campaign-progress must require the internal secret");
  }

  console.log("ALL INTERNAL-SECRET TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
