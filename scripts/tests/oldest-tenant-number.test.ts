// Tenant default caller-id = its OLDEST number (lib/phone/oldest-number.ts),
// shared by call-me and the campaign test call. Mock numbers only.
// Run with:  npx tsx scripts/tests/oldest-tenant-number.test.ts
// The real-Postgres part runs only when OLDEST_NUMBER_TEST_DB_URL points at a
// THROWAWAY database (it inserts and deletes mock rows); otherwise it is skipped.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../../lib/db/schema";
import { oldestTenantNumber, oldestTenantNumberQuery } from "../../lib/phone/oldest-number";

// 1) The query orders by created_at ascending and takes one row (no connection
//    is opened: postgres-js is lazy and toSQL() only builds the statement).
{
  const offline = drizzle(postgres("postgres://mock:mock@127.0.0.1:1/mock"), { schema });
  const { sql, params } = oldestTenantNumberQuery("00000000-0000-0000-0000-000000000001", offline).toSQL();
  assert.match(sql, /order by "phone_numbers"\."created_at" asc/i, "oldest first");
  assert.match(sql, /limit \$\d+/i, "one row");
  assert.match(sql, /where "phone_numbers"\."user_id" = \$1/i, "scoped to the tenant");
  assert.deepEqual(params.slice(0, 1), ["00000000-0000-0000-0000-000000000001"]);
}

// 2) Both routes go through the shared helper (they cannot diverge again).
for (const path of ["../../app/api/dashboard/call-me/route.ts", "../../app/api/dashboard/campaigns/[id]/test-call/route.ts"]) {
  const src = readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(src, /from "@\/lib\/phone\/oldest-number"/, `${path} imports the helper`);
  assert.match(src, /await oldestTenantNumber\(r\.userId\)/, `${path} calls the helper`);
  assert.doesNotMatch(src, /\.from\(phoneNumbers\)/, `${path} has no ad-hoc phone_numbers query`);
}
{
  const src = readFileSync(new URL("../../app/api/dashboard/campaigns/[id]/test-call/route.ts", import.meta.url), "utf8");
  assert.match(src, /campaign\.fromNumber\?\.trim\(\) \|\| ""/, "the campaign's own number still wins");
  assert.match(src, /no_caller_id/, "still 409 no_caller_id when the tenant has no number");
}

// 3) Real Postgres: two numbers inserted NEWEST first -> the helper returns the oldest.
async function realDb(url: string) {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const tdb = drizzle(client, { schema });
  const email = `oldest-number-test-${Date.now()}@example.test`;
  try {
    const [user] = await client`insert into users (email, password_hash) values (${email}, '') returning id`;
    const userId = user.id as string;
    assert.equal(await oldestTenantNumber(userId, tdb), null, "no number -> null");
    await client`insert into phone_numbers (user_id, phone_number, created_at) values
      (${userId}, '+15550000002', '2026-11-02T10:00:00Z')`;
    await client`insert into phone_numbers (user_id, phone_number, created_at) values
      (${userId}, '+15550000001', '2026-11-01T10:00:00Z')`;
    assert.equal(await oldestTenantNumber(userId, tdb), "+15550000001", "oldest number wins");
    // Another tenant's older number is never picked.
    const [other] = await client`insert into users (email, password_hash) values (${"other-" + email}, '') returning id`;
    await client`insert into phone_numbers (user_id, phone_number, created_at) values
      (${other.id}, '+15550000009', '2020-01-01T00:00:00Z')`;
    assert.equal(await oldestTenantNumber(userId, tdb), "+15550000001", "scoped to the tenant");
    console.log("  real Postgres: oldest number returned");
  } finally {
    await client`delete from users where email in (${email}, ${"other-" + email})`;
    await client.end();
  }
}

async function main() {
  const url = process.env.OLDEST_NUMBER_TEST_DB_URL;
  if (url) await realDb(url);
  else console.log("  (real-Postgres part skipped: OLDEST_NUMBER_TEST_DB_URL not set)");
  console.log("oldest-tenant-number: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
