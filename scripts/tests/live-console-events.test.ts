// Campaign live console: the feed shows the campaign's web events AND the
// worker's own events (campaign under metadata.origin), never another
// campaign's. Mock data only.
//
// Pure part always runs:  npx tsx scripts/tests/live-console-events.test.ts
// SQL part needs a THROWAWAY Postgres, already migrated (scripts/migrate.mjs):
//   LIVE_CONSOLE_PG_URL=postgres://postgres@127.0.0.1:55442/postgres \
//     npx tsx scripts/tests/live-console-events.test.ts
// Only localhost URLs are accepted; the test writes and deletes rows.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eventContactId, WORKER_CONSOLE_NOISE } from "../../lib/campaigns/live-events";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// Exactly what the worker's remoteLog sends (src/remote-log.ts, finalMetadata):
// the caller's metadata, then origin and callId injected from the session
// context. A campaign session's origin comes from the room name
// (src/origin.ts campaignFromRoomName): userId is '' there.
function workerFinalMetadata(
  metadata: Record<string, unknown>,
  ctx: { origin?: Record<string, unknown>; callId?: string },
): Record<string, unknown> {
  const finalMetadata: Record<string, unknown> = { ...metadata };
  if (ctx.origin && finalMetadata["origin"] === undefined) finalMetadata["origin"] = ctx.origin;
  if (ctx.callId && finalMetadata["callId"] === undefined) finalMetadata["callId"] = ctx.callId;
  return finalMetadata;
}

const campaignOrigin = (campaignId: string, contactId: string) => ({
  kind: "campaign",
  campaignId,
  contactId,
  userId: "",
});

// 1. contactId of an event: top-level first, then the worker's origin
{
  assert.equal(eventContactId({ campaignId: "c1", contactId: "k1" }), "k1", "web event");
  assert.equal(
    eventContactId(workerFinalMetadata({ tool: "x" }, { origin: campaignOrigin("c1", "k2"), callId: "call-1" })),
    "k2",
    "worker event: contact from origin",
  );
  assert.equal(eventContactId({ origin: { kind: "sip", contactId: "k3" } }), null, "non-campaign origin ignored");
  assert.equal(eventContactId({ contactId: 42 }), null, "non-string contactId");
  assert.equal(eventContactId(null), null);
  assert.equal(eventContactId({}), null);
}

// 1b. The noise deny list hides diagnostics only, never the call's story
{
  for (const e of ["chatctx_snapshot", "config_loaded", "call_metrics"]) {
    assert.ok((WORKER_CONSOLE_NOISE as readonly string[]).includes(e), `${e} hidden`);
  }
  for (const e of ["call_started", "call_ended", "call_transfer", "call_refused", "auto_hangup", "realtime_server_error", "realtime_fatal_error", "session_start_failed", "campaign_dial"]) {
    assert.ok(!(WORKER_CONSOLE_NOISE as readonly string[]).includes(e), `${e} kept`);
  }
}

// 2. The live route uses the shared predicate and helper (no inline top-level-only filter)
{
  const route = read("app/api/dashboard/campaigns/[id]/live/route.ts");
  assert.match(route, /campaignEventsWhere\(id\)/);
  assert.match(route, /contactId: eventContactId\(e\.metadata\)/);
  assert.doesNotMatch(route, /\? 'campaignId'/, "the old top-level-only filter is gone");
  assert.match(route, /requireAdmin\(\)/, "admin-only scope kept");
}

// 3. The migration is idempotent and matches the schema index
{
  const mig = read("drizzle/0048_events_origin_campaign.sql");
  assert.match(mig, /CREATE INDEX IF NOT EXISTS "events_origin_campaign_created_idx"/);
  assert.match(mig, /\("metadata"->'origin'->>'campaignId'\),"created_at"\)/);
  assert.match(mig, /WHERE \("events"\."metadata"->'origin'->>'kind'\) = 'campaign'/);
}

const PG_URL = process.env.LIVE_CONSOLE_PG_URL;
if (!PG_URL) {
  console.log("live-console-events: pure checks ok (SQL part skipped, set LIVE_CONSOLE_PG_URL)");
} else {
  const host = new URL(PG_URL).hostname;
  assert.ok(host === "127.0.0.1" || host === "localhost", "LIVE_CONSOLE_PG_URL must be a local throwaway database");
  // No top-level await under tsx's cjs output.
  sqlPart(PG_URL).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

async function sqlPart(url: string) {
  // lib/db reads DATABASE_URL lazily; the events route checks INTERNAL_SECRET. Both mock.
  process.env.DATABASE_URL = url;
  process.env.INTERNAL_SECRET = "test-internal-secret";

  const { and, desc, eq, sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { events } = await import("../../lib/db/schema");
  const { campaignEventsWhere } = await import("../../lib/campaigns/live-events");
  const { POST: postEvent } = await import("../../app/api/events/route");
  const { logEvent } = await import("../../lib/logger");

  const tag = `live-console-test-${randomUUID()}`; // every row carries it, for cleanup
  const campaignA = randomUUID();
  const campaignB = randomUUID();
  const contactA = randomUUID();
  const contactB = randomUUID();

  // Worker events go through the real ingestion route, as the worker posts them.
  async function postWorker(
    event: string,
    campaignId: string,
    contactId: string,
    metadata: Record<string, unknown>,
    level: "info" | "warn" | "error" = "info",
  ) {
    const body = {
      source: "agent",
      event,
      message: `mock ${event}`,
      level,
      metadata: workerFinalMetadata(
        { ...metadata, testTag: tag },
        { origin: campaignOrigin(campaignId, contactId), callId: `call-${contactId}` },
      ),
    };
    const res = await postEvent(
      new NextRequest("http://localhost/api/events", {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": "test-internal-secret" },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(res.status, 200, `POST /api/events ${event}`);
  }

  try {
    // Web-side events (top-level campaignId), as dispatch.ts / campaign-progress log them.
    await logEvent({ source: "web", event: "campaign_dial", message: "mock dial", metadata: { campaignId: campaignA, contactId: contactA, attempt: 1, testTag: tag } });
    await logEvent({ source: "web", event: "campaign_dial", message: "mock dial", metadata: { campaignId: campaignB, contactId: contactB, attempt: 1, testTag: tag } });
    // Worker events of both campaigns.
    await postWorker("call_started", campaignA, contactA, { roomName: `campaign__${campaignA}__${contactA}__1` });
    await postWorker("call_transfer", campaignA, contactA, { requested: "mock" });
    await postWorker("call_started", campaignB, contactB, { roomName: `campaign__${campaignB}__${contactB}__1` });
    // Worker noise for campaign A: hidden, unless level = error.
    await postWorker("chatctx_snapshot", campaignA, contactA, { items: ["mock"] });
    await postWorker("config_loaded", campaignA, contactA, { model: "mock" });
    await postWorker("config_loaded", campaignA, contactA, { model: "mock" }, "error");
    // A web-side event with a noise name stays: the deny list is worker-branch only.
    await logEvent({ source: "web", event: "config_loaded", message: "mock web", metadata: { campaignId: campaignA, contactId: contactA, testTag: tag } });
    // Look-alikes that must never match campaign A.
    await logEvent({ source: "agent", event: "call_started", message: "mock sip", metadata: { origin: { kind: "sip", campaignId: campaignA }, testTag: tag } });
    await logEvent({ source: "agent", event: "config_loaded", message: "mock no origin", metadata: { testTag: tag } });

    // The stored shape is the posted shape (lib/logger.ts keeps metadata as-is).
    const [stored] = await db
      .select({ metadata: events.metadata, userId: events.userId })
      .from(events)
      .where(and(sql`${events.metadata}->>'testTag' = ${tag}`, eq(events.event, "call_transfer")));
    assert.equal(stored.metadata.campaignId, undefined, "worker event has no top-level campaignId");
    assert.deepEqual(stored.metadata, {
      requested: "mock",
      testTag: tag,
      origin: { kind: "campaign", campaignId: campaignA, contactId: contactA, userId: "" },
      callId: `call-${contactA}`,
    });
    assert.equal(stored.userId, null, "origin.userId '' resolves no user");

    const feed = (where: ReturnType<typeof sql>) =>
      db
        .select({ event: events.event, metadata: events.metadata })
        .from(events)
        .where(and(where, sql`${events.metadata}->>'testTag' = ${tag}`))
        .orderBy(desc(events.createdAt))
        .limit(100);

    // Before (main): the top-level-only filter misses the worker's events.
    const before = await feed(sql`${events.metadata} ? 'campaignId' AND (${events.metadata}->>'campaignId') = ${campaignA}`);
    assert.deepEqual(before.map((r) => r.event).sort(), ["campaign_dial", "config_loaded"], "main: only the web events");

    // After: both shapes of campaign A, nothing of campaign B, no look-alike,
    // no worker noise (chatctx_snapshot, info config_loaded), errors kept.
    const after = await feed(campaignEventsWhere(campaignA));
    assert.deepEqual(after.map((r) => r.event).sort(), ["call_started", "call_transfer", "campaign_dial", "config_loaded", "config_loaded"]);
    assert.ok(!after.some((r) => r.event === "chatctx_snapshot"), "chatctx_snapshot hidden");
    const keptConfig = await db
      .select({ level: events.level, source: events.source })
      .from(events)
      .where(and(campaignEventsWhere(campaignA), eq(events.event, "config_loaded"), sql`${events.metadata}->>'testTag' = ${tag}`));
    assert.deepEqual(
      keptConfig.map((r) => `${r.source}:${r.level}`).sort(),
      ["agent:error", "web:info"],
      "worker info config_loaded hidden; worker error and web-side kept",
    );
    for (const r of after) {
      const m = r.metadata as Record<string, unknown>;
      const origin = m.origin as Record<string, unknown> | undefined;
      assert.ok(m.campaignId === campaignA || origin?.campaignId === campaignA, "only campaign A");
      assert.equal(eventContactId(m), contactA, "contact resolved for every line");
    }
    const afterB = await feed(campaignEventsWhere(campaignB));
    assert.deepEqual(afterB.map((r) => r.event).sort(), ["call_started", "campaign_dial"]);
    assert.equal((await feed(campaignEventsWhere(randomUUID()))).length, 0, "unknown campaign: nothing");

    // 150 noisy worker events after one campaign_dial: the dial stays in the 100-event window.
    const campaignC = randomUUID();
    const contactC = randomUUID();
    await logEvent({ source: "web", event: "campaign_dial", message: "mock dial", metadata: { campaignId: campaignC, contactId: contactC, attempt: 1, testTag: tag } });
    for (let i = 0; i < 150; i++) {
      await postWorker(WORKER_CONSOLE_NOISE[i % WORKER_CONSOLE_NOISE.length], campaignC, contactC, { i });
    }
    const windowC = await feed(campaignEventsWhere(campaignC));
    assert.deepEqual(windowC.map((r) => r.event), ["campaign_dial"], "noise takes no slot");

    // Index: both branches are index-servable (BitmapOr of the two partial indexes).
    const q = db
      .select({ id: events.id })
      .from(events)
      .where(campaignEventsWhere(campaignA))
      .orderBy(desc(events.createdAt))
      .limit(100)
      .toSQL();
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      const rows = await tx.execute(sql.raw(`EXPLAIN ${q.sql.replace(/\$(\d+)/g, (_, n) => `'${String(q.params[Number(n) - 1]).replace(/'/g, "''")}'`)}`));
      return (rows as unknown as Array<{ "QUERY PLAN": string }>).map((r) => r["QUERY PLAN"]).join("\n");
    });
    assert.match(plan, /events_campaign_created_idx/, plan);
    assert.match(plan, /events_origin_campaign_created_idx/, plan);
  } finally {
    await db.delete(events).where(sql`${events.metadata}->>'testTag' = ${tag}`);
  }
  console.log("live-console-events: pure + SQL checks ok");
  process.exit(0); // the lazy postgres-js pool keeps the event loop alive
}
