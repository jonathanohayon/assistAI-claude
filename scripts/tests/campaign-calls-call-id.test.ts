// campaign_calls.worker_call_id (M2c): the worker's call id (x-call-id) is
// stored on each campaign call, NULL when the header is absent or malformed.
//
// Part 1 (always): request → stored value, through the pure helper the route uses.
// Part 2 (throwaway Postgres only): migration fresh / from origin/main / re-run,
// insert, and the dashboard response byte-identical to origin/main. Plain
// `npm test` skips it. Run it with:
//   bash scripts/campaign-calls-call-id-db.sh
// Only a 127.0.0.1/localhost URL is accepted and DATABASE_URL is never read.
// All data is mock.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { campaignCallPublicColumns, campaignCallRow, type CampaignCallInput } from "../../lib/campaigns/campaign-call-row";

const req = (headers: Record<string, string>) => ({
  headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
});
const input: CampaignCallInput = {
  campaignId: "00000000-0000-4000-8000-0000000000c1",
  contactId: "00000000-0000-4000-8000-0000000000b1",
  userId: "00000000-0000-4000-8000-0000000000a1",
  phoneNumber: "+15555550100",
  outcome: "connected",
  transcript: [{ role: "user", text: "hello" }],
  durationSeconds: 12,
};

// ── Part 1: pure ────────────────────────────────────────────────────────
{
  // a valid header is stored as-is (the worker sends a 16-hex hash of the room name)
  assert.equal(campaignCallRow(input, req({ "x-call-id": "2cf4088f57340c9b" })).workerCallId, "2cf4088f57340c9b");
  // absent header → null
  assert.equal(campaignCallRow(input, req({})).workerCallId, null);
  // malformed headers → null
  for (const bad of ["", "has space", "a/b", "x".repeat(129), "id;drop"]) {
    assert.equal(campaignCallRow(input, req({ "x-call-id": bad })).workerCallId, null, `malformed: ${JSON.stringify(bad)}`);
  }
  // every other field is passed through unchanged
  const { workerCallId: _w, ...rest } = campaignCallRow(input, req({ "x-call-id": "abc" }));
  void _w;
  assert.deepEqual(rest, input);
  // the dashboard column list is every column except the new one
  assert.equal("workerCallId" in campaignCallPublicColumns, false);
  assert.deepEqual(Object.keys(campaignCallPublicColumns), [
    "id", "campaignId", "contactId", "userId", "callId", "phoneNumber", "outcome",
    "disposition", "sentiment", "summary", "transcript", "extracted",
    "durationSeconds", "costCents", "createdAt",
  ]);
  console.log("ok: campaign-call-row (valid → stored, absent → null, malformed → null)");
}

// ── Part 2: throwaway Postgres ──────────────────────────────────────────
const url = process.env.CAMPAIGN_CALLS_TEST_DATABASE_URL;
const phase = process.env.CAMPAIGN_CALLS_TEST_PHASE;
if (!url || !phase) {
  console.log("skip: campaign-calls-call-id DB part (no CAMPAIGN_CALLS_TEST_DATABASE_URL — see scripts/campaign-calls-call-id-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(`refusing to run against non-local database host ${host}`);
}
process.env.DATABASE_URL = url;

const SNAPSHOT = process.env.CAMPAIGN_CALLS_MAIN_SNAPSHOT ?? "";

async function main() {
  const { sql, eq, asc } = await import("drizzle-orm");
  const { NextResponse } = await import("next/server");
  const { db } = await import("../../lib/db");

  const migrationsApplied = async () =>
    ((await db.execute(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)) as unknown as Array<{ n: number }>)[0]!.n;
  const columnInfo = async () =>
    [...(await db.execute(sql`
      SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'campaign_calls' AND column_name = 'worker_call_id'`)) as unknown as Array<{ data_type: string; is_nullable: string }>].map((r) => ({ ...r }));
  const indexCount = async () =>
    ((await db.execute(sql`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'campaign_calls_worker_call_id_idx'`)) as unknown as Array<{ n: number }>)[0]!.n;
  const rerunMigrate = () =>
    execFileSync("node", ["scripts/migrate.mjs"], {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DATABASE_URL: url! } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });

  // Mock tenant/campaign/contact + two calls with fixed ids and timestamps.
  // Raw SQL so the same seed runs on the origin/main schema and on this branch.
  const seed = async () => {
    await db.execute(sql`INSERT INTO users (id, email, password_hash) VALUES (${input.userId}, 'mock-tenant@example.test', 'x') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO campaigns (id, user_id, name) VALUES (${input.campaignId}, ${input.userId}, 'Mock campaign') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO campaign_contacts (id, campaign_id, user_id, phone_number) VALUES (${input.contactId}, ${input.campaignId}, ${input.userId}, ${input.phoneNumber}) ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO campaign_calls (id, campaign_id, contact_id, user_id, phone_number, outcome, transcript, duration_seconds, created_at) VALUES
      ('00000000-0000-4000-8000-0000000000d1', ${input.campaignId}, ${input.contactId}, ${input.userId}, ${input.phoneNumber}, 'connected', '[{"role":"user","text":"hello"}]'::jsonb, 12, '2026-11-01T10:00:00Z'),
      ('00000000-0000-4000-8000-0000000000d2', ${input.campaignId}, ${input.contactId}, ${input.userId}, ${input.phoneNumber}, 'no_answer', '[]'::jsonb, 0, '2026-11-01T11:00:00Z')
      ON CONFLICT DO NOTHING`);
  };

  if (phase === "main-snapshot") {
    // origin/main state: seed, then serialise the calls exactly like the
    // origin/main route (bare select() with origin/main's schema).
    const mainSchemaPath = process.env.CAMPAIGN_CALLS_MAIN_SCHEMA!;
    const mainSchema = (await import(mainSchemaPath)) as typeof import("../../lib/db/schema");
    assert.equal((await columnInfo()).length, 0, "before (pre-#277) state has no worker_call_id yet");
    await seed();
    const calls = await db
      .select()
      .from(mainSchema.campaignCalls)
      .where(eq(mainSchema.campaignCalls.campaignId, input.campaignId))
      .orderBy(asc(mainSchema.campaignCalls.createdAt));
    writeFileSync(SNAPSHOT, await NextResponse.json({ calls }).text());
    console.log(`ok: before snapshot written (${calls.length} calls)`);
    return;
  }

  // fresh / upgrade: the branch's migrations are applied.
  assert.deepEqual(await columnInfo(), [{ data_type: "text", is_nullable: "YES" }]);
  assert.equal(await indexCount(), 1);

  // re-running the migrations is a no-op
  const before = await migrationsApplied();
  const out = rerunMigrate();
  assert.match(out, /\[migrate\] ok/);
  assert.equal(await migrationsApplied(), before, "re-run applies nothing");
  assert.deepEqual(await columnInfo(), [{ data_type: "text", is_nullable: "YES" }]);
  assert.equal(await indexCount(), 1);
  // the SQL itself is idempotent too (IF NOT EXISTS), even if replayed by hand
  const raw = readFileSync("drizzle/0047_campaign_calls_worker_call_id.sql", "utf8");
  for (const stmt of raw.split("--> statement-breakpoint")) await db.execute(sql.raw(stmt));
  assert.equal(await indexCount(), 1);
  console.log(`ok: ${phase}: column text NULL + index; re-run no-op (${before} migrations)`);

  if (phase === "upgrade") {
    // rows written before the column read back as NULL, and the dashboard
    // response bytes are identical to origin/main's
    const { campaignCalls } = await import("../../lib/db/schema");
    const old = await db.select({ w: campaignCalls.workerCallId }).from(campaignCalls);
    assert.deepEqual(old.map((r) => r.w), [null, null]);
    const calls = await db
      .select(campaignCallPublicColumns)
      .from(campaignCalls)
      .where(eq(campaignCalls.campaignId, input.campaignId))
      .orderBy(asc(campaignCalls.createdAt));
    const branchBytes = await NextResponse.json({ calls }).text();
    const mainBytes = readFileSync(SNAPSHOT, "utf8");
    assert.equal(branchBytes, mainBytes, "dashboard calls JSON byte-identical to the pre-#277 tree");
    console.log(`ok: upgrade: old rows NULL; dashboard calls JSON byte-identical to the pre-#277 tree (${mainBytes.length} bytes)`);
  } else {
    await seed();
  }

  // insert through the route's helper: valid → stored, absent/malformed → null
  const { campaignCalls } = await import("../../lib/db/schema");
  const cases: Array<[Record<string, string>, string | null]> = [
    [{ "x-call-id": "2cf4088f57340c9b" }, "2cf4088f57340c9b"],
    [{}, null],
    [{ "x-call-id": "not valid!" }, null],
  ];
  for (const [headers, expected] of cases) {
    const [row] = await db.insert(campaignCalls).values(campaignCallRow(input, req(headers))).returning();
    assert.equal(row!.workerCallId, expected);
  }
  const hit = await db
    .select({ id: campaignCalls.id })
    .from(campaignCalls)
    .where(eq(campaignCalls.workerCallId, "2cf4088f57340c9b"));
  assert.equal(hit.length, 1, "joinable on the stored id");
  console.log(`ok: ${phase}: insert valid → stored, absent → NULL, malformed → NULL`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
