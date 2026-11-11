// calls.to_number: the number the caller dialed, stored at call end.
// Run with:  npx tsx scripts/tests/calls-to-number.test.ts
//
// The real-Postgres part runs only when CALLS_TO_NUMBER_TEST_DB_URL points
// at a THROWAWAY server (it creates and drops its own databases there):
//   - migrate a fresh database up to the latest migration,
//   - migrate a database stopped at the migration before 0046 (origin/main
//     before this change), proving 0046 is not skipped,
//   - re-run the migrations on both: no error, nothing new applied,
//   - insert a calls row with callInsertValues() and read to_number back.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { callInsertValues, parseCallEndBody } from "../../lib/call-end-body";
import { calls } from "../../lib/db/schema";

const MIGRATION_TAG = "0046_calls_to_number";

function unitTests() {
  // the dialed number is stored, trimmed like fromNumber
  const v = callInsertValues(
    parseCallEndBody({
      fromNumber: " +15550000001 ",
      toNumber: " +15550000002 ",
      transcript: [{ role: "user", text: "hello" }],
      durationSeconds: 12,
    }),
    "user-1",
    "room-1",
  );
  assert.equal(v.toNumber, "+15550000002");
  assert.equal(v.fromNumber, "+15550000001");
  assert.equal(v.userId, "user-1");
  assert.equal(v.callId, "room-1");
  assert.equal(v.summary, "");
  assert.equal(v.durationSeconds, 12);

  // missing, empty, blank or non-string `toNumber` -> ''
  for (const toNumber of [undefined, "", "   ", null, 42, {}]) {
    const body = toNumber === undefined ? {} : { toNumber };
    assert.equal(callInsertValues(parseCallEndBody(body), "u", null).toNumber, "", `toNumber=${JSON.stringify(toNumber)}`);
  }
  // no body at all -> '' too, and a null call id is stored as ''
  const empty = callInsertValues(parseCallEndBody(undefined), "u", null);
  assert.equal(empty.toNumber, "");
  assert.equal(empty.callId, "");
  console.log("  insert values: to_number stored, '' when missing");
}

/** Copy of ./drizzle holding only the migrations before 0046 (origin/main). */
function previousMigrationsFolder(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "calls-to-number-"));
  fs.cpSync("drizzle", dir, { recursive: true });
  fs.rmSync(path.join(dir, `${MIGRATION_TAG}.sql`));
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  journal.entries = journal.entries.filter((e: { tag: string }) => e.tag !== MIGRATION_TAG);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

async function runMigrations(url: string, folder: string) {
  const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    await client.end();
  }
}

async function appliedCount(url: string): Promise<number> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [r] = await client`select count(*)::int as n from drizzle.__drizzle_migrations`;
    return r.n;
  } finally {
    await client.end();
  }
}

async function toNumberColumn(url: string) {
  const client = postgres(url, { max: 1 });
  try {
    const [c] = await client`
      select data_type, is_nullable, column_default
      from information_schema.columns
      where table_name = 'calls' and column_name = 'to_number'`;
    return c ?? null;
  } finally {
    await client.end();
  }
}

async function realDb(adminUrl: string) {
  const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8"));
  const total: number = journal.entries.length;
  const last = journal.entries[total - 1];
  assert.equal(last.tag, MIGRATION_TAG, "0046 is the last migration");
  const prevWhen = journal.entries[total - 2].when;
  assert.ok(last.when > prevWhen, "0046 sorts after every earlier migration (not skipped)");

  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const dbs = ["calls_to_number_fresh", "calls_to_number_upgrade"];
  const urlFor = (name: string) => {
    const u = new URL(adminUrl);
    u.pathname = `/${name}`;
    return u.toString();
  };
  const prevFolder = previousMigrationsFolder();
  try {
    for (const name of dbs) {
      await admin.unsafe(`drop database if exists ${name}`);
      await admin.unsafe(`create database ${name}`);
    }
    const fresh = urlFor(dbs[0]);
    const upgrade = urlFor(dbs[1]);

    // fresh database: every migration applies, the column exists
    await runMigrations(fresh, "drizzle");
    assert.equal(await appliedCount(fresh), total);
    const col = await toNumberColumn(fresh);
    assert.ok(col, "to_number exists on a fresh database");
    assert.equal(col.data_type, "text");
    assert.equal(col.is_nullable, "NO");
    assert.equal(col.column_default, "''::text");
    console.log("  real Postgres: fresh database migrated");

    // database at origin/main (before 0046), with an old call row
    await runMigrations(upgrade, prevFolder);
    assert.equal(await appliedCount(upgrade), total - 1);
    assert.equal(await toNumberColumn(upgrade), null, "no to_number before 0046");
    const up = postgres(upgrade, { max: 1 });
    try {
      const [u] = await up`insert into users (email, password_hash) values ('old@example.test', '') returning id`;
      await up`insert into calls (user_id, from_number) values (${u.id}, '+15550000011')`;
    } finally {
      await up.end();
    }
    await runMigrations(upgrade, "drizzle");
    assert.equal(await appliedCount(upgrade), total, "0046 applied on top of origin/main");
    assert.ok(await toNumberColumn(upgrade), "to_number added on upgrade");
    const check = postgres(upgrade, { max: 1 });
    try {
      const [old] = await check`select to_number from calls where from_number = '+15550000011'`;
      assert.equal(old.to_number, "", "old rows read '' (no backfill)");
    } finally {
      await check.end();
    }
    console.log("  real Postgres: origin/main database upgraded, old rows ''");

    // re-run on both: no error, nothing new recorded
    for (const url of [fresh, upgrade]) {
      await runMigrations(url, "drizzle");
      assert.equal(await appliedCount(url), total);
    }
    // the SQL itself is idempotent too (column already there)
    const raw = postgres(fresh, { max: 1, onnotice: () => {} });
    try {
      await raw.unsafe(fs.readFileSync(`drizzle/${MIGRATION_TAG}.sql`, "utf8"));
    } finally {
      await raw.end();
    }
    console.log("  real Postgres: re-run is a no-op");

    // insert with the route's own values
    const client = postgres(fresh, { max: 1 });
    try {
      const tdb = drizzle(client);
      const [u] = await client`insert into users (email, password_hash) values ('new@example.test', '') returning id`;
      const withTo = callInsertValues(
        parseCallEndBody({ fromNumber: "+15550000021", toNumber: " +15550000022 " }),
        u.id,
        "room-test",
      );
      const withoutTo = callInsertValues(parseCallEndBody({ fromNumber: "+15550000031" }), u.id, null);
      const [a] = await tdb.insert(calls).values(withTo).returning();
      const [b] = await tdb.insert(calls).values(withoutTo).returning();
      assert.equal(a.toNumber, "+15550000022");
      assert.equal(a.callId, "room-test");
      assert.equal(b.toNumber, "");
    } finally {
      await client.end();
    }
    console.log("  real Postgres: insert stores to_number");
  } finally {
    for (const name of dbs) await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.end();
    fs.rmSync(prevFolder, { recursive: true, force: true });
  }
}

async function main() {
  unitTests();
  const url = process.env.CALLS_TO_NUMBER_TEST_DB_URL;
  if (url) await realDb(url);
  else console.log("  (real-Postgres part skipped: CALLS_TO_NUMBER_TEST_DB_URL not set)");
  console.log("calls-to-number: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
