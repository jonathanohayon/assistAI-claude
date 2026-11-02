// /api/agent/config must refuse any caller without the worker's secret.
// Run with:  npx tsx scripts/tests/agent-config-auth.test.ts
// The guard returns before any DB access, so no database is needed.

import assert from "node:assert/strict";

import { NextRequest } from "next/server";

process.env.INTERNAL_SECRET = "test-internal-secret";
delete process.env.DATABASE_URL;

async function main() {
  const { GET } = await import("../../app/api/agent/config/route");
  const url = "https://example.test/api/agent/config?phone=%2B15550000002";

  // no header -> 401
  let res = await GET(new NextRequest(url));
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "unauthorized" });

  // wrong secret -> 401
  res = await GET(new NextRequest(url, { headers: { "x-internal-secret": "nope" } }));
  assert.equal(res.status, 401);

  // no params and no secret (the default-tenant path) -> 401 as well
  res = await GET(new NextRequest("https://example.test/api/agent/config"));
  assert.equal(res.status, 401);

  console.log("ALL AGENT-CONFIG-AUTH TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
