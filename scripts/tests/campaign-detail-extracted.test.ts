// GET /api/dashboard/campaigns/[id] must never return capture claim internals
// (pending, token, attempt, claimedAt) from campaign_calls.extracted.
//
// Part 1 (always): the pure mapping the route uses + a source-level guard.
// Part 2 (throwaway Postgres only): rows seeded with every extracted shape,
// read with the route's own select, mapped, deep-scanned; {} rows give bytes
// identical to the unmapped (branch base) response. Plain `npm test` skips it.
// Run it with:
//   bash scripts/campaign-detail-extracted-db.sh
// Only a 127.0.0.1/localhost URL is accepted and DATABASE_URL is never read.
// All data is mock.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { campaignDetailCalls, publicExtracted } from "../../lib/campaigns/campaign-call-row";

const INTERNAL_KEYS = ["pending", "token", "attempt", "claimedAt"];

/** Every key name anywhere in a JSON text (deep). */
function allKeys(json: string): Set<string> {
  const keys = new Set<string>();
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      for (const [k, v] of Object.entries(x)) {
        keys.add(k);
        walk(v);
      }
    }
  };
  walk(JSON.parse(json));
  return keys;
}
function assertNoInternals(json: string, label: string) {
  const keys = allKeys(json);
  for (const k of INTERNAL_KEYS) assert.equal(keys.has(k), false, `${label}: "${k}" leaked`);
  assert.equal(json.includes("mock-claim-token"), false, `${label}: claim token value leaked`);
}

const pendingClaim = { v: 1, pending: true, claimedAt: "2026-11-01T10:00:00.000Z", token: "mock-claim-token", attempt: 1 };
const exhaustedClaim = { ...pendingClaim, attempt: 3 };
const completed = {
  v: 1,
  source: "conversation",
  at: "2026-11-01T10:01:00.000Z",
  model: "mock-model",
  values: { interested: true, budget: 1200 },
  missing: ["email"],
};
const completedNoMissing = { ...completed, missing: [] };

const row = (id: string, extracted: unknown) => ({
  id,
  campaignId: "00000000-0000-4000-8000-0000000000c1",
  contactId: "00000000-0000-4000-8000-0000000000b1",
  userId: "00000000-0000-4000-8000-0000000000a1",
  callId: null,
  phoneNumber: "+15555550100",
  outcome: "connected",
  disposition: "",
  sentiment: "",
  summary: "",
  transcript: [{ role: "user", text: "hello" }],
  extracted,
  durationSeconds: 12,
  costCents: 0,
  createdAt: new Date("2026-11-01T10:00:00Z"),
});

// ── Part 1: pure ────────────────────────────────────────────────────────
{
  // {} → {} (no attempt; always the case when CAMPAIGN_CAPTURE is off)
  assert.deepEqual(publicExtracted({}), {});
  // pending / exhausted claim → null
  assert.equal(publicExtracted(pendingClaim), null);
  assert.equal(publicExtracted(exhaustedClaim), null);
  // a claim that lost its `pending` flag is not a completed capture either → null
  const { pending: _p, ...claimNoFlag } = pendingClaim;
  void _p;
  assert.equal(publicExtracted(claimNoFlag), null);
  // completed → the results route's public shape (no v/at/model)
  assert.deepEqual(publicExtracted(completed), {
    source: "conversation",
    values: { interested: true, budget: 1200 },
    missing: ["email"],
  });
  assert.deepEqual(publicExtracted(completedNoMissing), { source: "conversation", values: { interested: true, budget: 1200 } });
  // garbage → null (fail closed)
  for (const bad of [null, undefined, "x", 1, true, [], [{}], { foo: 1 }, { v: 2, source: "conversation", values: {} }, { v: 1, source: "other", values: {} }, { v: 1, source: "conversation", values: [] }]) {
    assert.equal(publicExtracted(bad), null, `garbage: ${JSON.stringify(bad)}`);
  }
  console.log("ok: publicExtracted ({} → {}, claim → null, completed → public shape, garbage → null)");
}

{
  // the raw rows DO carry the internals (so the scan below is meaningful)...
  const rows = [row("r1", {}), row("r2", pendingClaim), row("r3", exhaustedClaim), row("r4", completed), row("r5", { foo: 1 })];
  assert.throws(() => assertNoInternals(JSON.stringify({ calls: rows }), "raw"));
  // ...and the mapped calls never do
  const mapped = campaignDetailCalls(rows);
  assertNoInternals(JSON.stringify({ calls: mapped }), "mapped");
  assert.deepEqual(mapped.map((c) => c.extracted), [{}, null, null, { source: "conversation", values: { interested: true, budget: 1200 }, missing: ["email"] }, null]);
  // same keys, same order as the stored row
  for (const [i, m] of mapped.entries()) assert.deepEqual(Object.keys(m), Object.keys(rows[i]!));
  // OFF: every row at {} → bytes identical to the unmapped response
  const off = [row("o1", {}), row("o2", {})];
  assert.equal(JSON.stringify({ calls: campaignDetailCalls(off) }), JSON.stringify({ calls: off }));
  console.log("ok: campaignDetailCalls (no internals, key order kept, {} rows byte-identical)");
}

{
  // source guard: the route maps the calls through campaignDetailCalls
  const src = readFileSync("app/api/dashboard/campaigns/[id]/route.ts", "utf8");
  assert.match(src, /const calls = campaignDetailCalls\(await db\s*\.select\(campaignCallPublicColumns\)/);
  assert.match(src, /NextResponse\.json\(\{ campaign, agent: [^\n]*, contacts, calls, counts \}\)/);
  // the results route maps through resultsCallView (capturedView), never a raw extracted
  const results = readFileSync("app/api/dashboard/campaigns/[id]/results/route.ts", "utf8");
  assert.match(results, /calls: rows\.map\(\(c\) => resultsCallView\(c, mode\)\)/);
  assert.equal(/extracted/.test(results), false, "results route never reads extracted directly");
  console.log("ok: source guard (detail route uses campaignDetailCalls; results route uses resultsCallView)");
}

// ── Part 2: throwaway Postgres ──────────────────────────────────────────
const url = process.env.CAMPAIGN_DETAIL_TEST_DATABASE_URL;
if (!url) {
  console.log("skip: campaign-detail-extracted DB part (no CAMPAIGN_DETAIL_TEST_DATABASE_URL — see scripts/campaign-detail-extracted-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(`refusing to run against non-local database host ${host}`);
}
process.env.DATABASE_URL = url;

async function main() {
  const { sql, eq, desc } = await import("drizzle-orm");
  const { NextResponse } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { campaignCalls } = await import("../../lib/db/schema");
  const { campaignCallPublicColumns } = await import("../../lib/campaigns/campaign-call-row");

  const u = "00000000-0000-4000-8000-0000000000a1";
  const seedCampaign = async (cid: string, kid: string) => {
    await db.execute(sql`INSERT INTO campaigns (id, user_id, name) VALUES (${cid}, ${u}, 'Mock campaign') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO campaign_contacts (id, campaign_id, user_id, phone_number) VALUES (${kid}, ${cid}, ${u}, '+15555550100') ON CONFLICT DO NOTHING`);
  };
  const insertCall = async (id: string, cid: string, kid: string, at: string, extracted: unknown) =>
    db.execute(sql`INSERT INTO campaign_calls (id, campaign_id, contact_id, user_id, phone_number, outcome, transcript, extracted, duration_seconds, created_at)
      VALUES (${id}, ${cid}, ${kid}, ${u}, '+15555550100', 'connected', '[{"role":"user","text":"hello"}]'::jsonb, ${JSON.stringify(extracted)}::jsonb, 12, ${at})`);
  // The route's query, unmapped (branch base) and mapped (this branch).
  const select = (cid: string) =>
    db.select(campaignCallPublicColumns).from(campaignCalls).where(eq(campaignCalls.campaignId, cid)).orderBy(desc(campaignCalls.createdAt)).limit(200);

  await db.execute(sql`INSERT INTO users (id, email, password_hash) VALUES (${u}, 'mock-tenant@example.test', 'x') ON CONFLICT DO NOTHING`);

  // OFF: every call at {} → byte-identical to the branch base.
  const off = "00000000-0000-4000-8000-0000000000c1";
  await seedCampaign(off, "00000000-0000-4000-8000-0000000000b1");
  await insertCall("00000000-0000-4000-8000-0000000000d1", off, "00000000-0000-4000-8000-0000000000b1", "2026-11-01T10:00:00Z", {});
  await insertCall("00000000-0000-4000-8000-0000000000d2", off, "00000000-0000-4000-8000-0000000000b1", "2026-11-01T11:00:00Z", {});
  const rawOff = await select(off);
  const baseBytes = await NextResponse.json({ calls: rawOff }).text();
  const branchBytes = await NextResponse.json({ calls: campaignDetailCalls(rawOff) }).text();
  assert.equal(branchBytes, baseBytes, "OFF: calls JSON byte-identical to the branch base");
  console.log(`ok: db: OFF calls JSON byte-identical to the branch base (${baseBytes.length} bytes)`);

  // ON: every shape stored for real, then read with the route's select.
  const on = "00000000-0000-4000-8000-0000000000c2";
  const k2 = "00000000-0000-4000-8000-0000000000b2";
  await seedCampaign(on, k2);
  const shapes: Array<[string, unknown, unknown]> = [
    ["00000000-0000-4000-8000-0000000000e1", {}, {}],
    ["00000000-0000-4000-8000-0000000000e2", pendingClaim, null],
    ["00000000-0000-4000-8000-0000000000e3", exhaustedClaim, null],
    ["00000000-0000-4000-8000-0000000000e4", completed, { source: "conversation", values: { interested: true, budget: 1200 }, missing: ["email"] }],
    ["00000000-0000-4000-8000-0000000000e5", { foo: 1 }, null],
  ];
  for (const [i, [id, stored]] of shapes.entries()) await insertCall(id, on, k2, `2026-11-02T1${i}:00:00Z`, stored);
  const rawOn = await select(on);
  const rawBytes = await NextResponse.json({ calls: rawOn }).text();
  assert.throws(() => assertNoInternals(rawBytes, "db raw"), "the stored rows really hold a claim");
  const mappedBytes = await NextResponse.json({ calls: campaignDetailCalls(rawOn) }).text();
  assertNoInternals(mappedBytes, "db mapped");
  const byId = new Map((JSON.parse(mappedBytes).calls as Array<{ id: string; extracted: unknown }>).map((c) => [c.id, c.extracted]));
  for (const [id, , expected] of shapes) assert.deepEqual(byId.get(id), expected, id);
  console.log("ok: db: pending/exhausted claim → null, completed → public shape, {} → {}, garbage → null; no internals");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
