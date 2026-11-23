// The dispatcher's tick per CAMPAIGN_DISPATCH mode, the campaigns list's
// `dispatchMode` and the live snapshot's `dispatcher.dispatchMode`, through
// the REAL dispatcher and route handlers against a THROWAWAY Postgres. Only
// the session and the dial are test doubles (scripts/tests/fixtures/
// campaigns-plan-gate/hooks.mjs); the dispatcher also gets an injected dialer.
//   off: no tick, nothing written;
//   dry: the tick (mode "dry" + counts, no PII), no claim, no dial, no
//        campaign_contacts change, nothing else written;
//   on:  the tick gains mode "on" (the rest as before).
// Run with:  bash scripts/campaign-dispatch-tick-db.sh
// Skipped in a plain `npm test`. Mock data only (example.test, +1555 numbers).

import assert from "node:assert/strict";

const url = process.env.DISPATCH_TICK_DB_URL;
if (!url) {
  console.log("SKIPPED campaign-dispatch-tick-db (run bash scripts/campaign-dispatch-tick-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /^(LIVEKIT|TWILIO)/.test(k))) throw new Error("refusing to run with LiveKit/Twilio env set");
if (!(globalThis as { __campgateHooks?: boolean }).__campgateHooks) throw new Error("module hooks missing: run through scripts/campaign-dispatch-tick-db.sh");
process.env.DATABASE_URL = url;
delete process.env.CAMPAIGN_DISPATCH;

type G = {
  __campgateSession?: { user: { id: string; email?: string } } | null;
  __campgateDials?: Array<Record<string, unknown>>;
};
const g = globalThis as G;

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ADMIN = id(0xad);
const TENANT = id(0xb1);
const OPEN = id(0xc1); // running, 24/7 UTC, concurrency 2, 3 contacts due
const CLOSED = id(0xc2); // running, call hours 0–0, 1 contact due
const OPEN_TITLE = "Mock Open Campaign";
const CLOSED_TITLE = "Mock Closed Campaign";
const B = "http://localhost";

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { dispatchDueJobs } = await import("../../lib/campaigns/dispatch");
  const { claimCampaignJobs } = await import("../../lib/campaigns/claim");
  const { DISPATCH_TICK_KEY } = await import("../../lib/campaigns/live");
  const list = await import("../../app/api/dashboard/campaigns/route");
  const live = await import("../../app/api/dashboard/campaigns/[id]/live/route");

  const rows = async (q: ReturnType<typeof sql>) => {
    const r = (await db.execute(q)) as unknown as unknown[] | { rows: unknown[] };
    return (Array.isArray(r) ? r : r.rows) as Record<string, unknown>[];
  };
  /** md5 of one table's full content. */
  const md5 = async (table: string) =>
    String((await rows(sql.raw(`select coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from "${table}" x`)))[0].h);
  const allTables = async () => {
    const names = (await rows(sql`select tablename from pg_tables where schemaname = 'public' order by 1`)).map((r) => String(r.tablename));
    const out: Record<string, string> = {};
    for (const n of names) out[n] = await md5(n);
    return out;
  };
  const changed = (a: Record<string, string>, b: Record<string, string>) => Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]);
  const tickRaw = async () => (await rows(sql`SELECT value FROM app_settings WHERE key = ${DISPATCH_TICK_KEY}`))[0]?.value as string | undefined;

  async function seed() {
    await db.execute(sql`DELETE FROM events`);
    await db.execute(sql`DELETE FROM app_settings`);
    await db.execute(sql`DELETE FROM users`); // cascades to campaigns, contacts, numbers
    await db.execute(sql`INSERT INTO users (id, email, password_hash, role, subscription_plan) VALUES
      (${ADMIN}, 'admin@example.test', 'x', 'admin', 'essential'),
      (${TENANT}, 'tenant@example.test', 'x', 'user', 'global')`);
    const open = JSON.stringify({ timezone: "UTC", days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24 });
    const closed = JSON.stringify({ timezone: "UTC", days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 0 });
    await db.execute(sql`INSERT INTO campaigns (id, user_id, name, status, from_number, concurrency, call_window) VALUES
      (${OPEN}, ${TENANT}, ${OPEN_TITLE}, 'running', '+15550100001', 2, ${open}::jsonb),
      (${CLOSED}, ${TENANT}, ${CLOSED_TITLE}, 'running', '+15550100001', 2, ${closed}::jsonb)`);
    await db.execute(sql`INSERT INTO campaign_contacts (campaign_id, user_id, phone_number, contact_name) VALUES
      (${OPEN}, ${TENANT}, '+15550109001', 'Mock Alice'),
      (${OPEN}, ${TENANT}, '+15550109002', 'Mock Bob'),
      (${OPEN}, ${TENANT}, '+15550109003', 'Mock Carol'),
      (${CLOSED}, ${TENANT}, '+15550109004', 'Mock Dave')`);
    g.__campgateDials = [];
  }

  // Injected doubles: count every claim and dial.
  let claims = 0;
  let dials = 0;
  const deps = (mode: string | undefined) => ({
    env: mode === undefined ? {} : { CAMPAIGN_DISPATCH: mode },
    claim: (async (...a: Parameters<typeof claimCampaignJobs>) => {
      claims++;
      return claimCampaignJobs(...a);
    }) as typeof claimCampaignJobs,
    dial: (async (o: { roomName: string }) => {
      dials++;
      return { roomName: o.roomName, participantId: "PA_mock" };
    }) as never,
    salesTrialGate: async () => null,
  });
  const reset = () => {
    claims = 0;
    dials = 0;
  };

  // 1. OFF (unset, empty, unknown): no tick, nothing written, nothing claimed or dialled.
  await seed();
  for (const mode of [undefined, "", "off", "yes"]) {
    reset();
    const before = await allTables();
    const r = await dispatchDueJobs(10, "cron", deps(mode));
    const after = await allTables();
    assert.deepEqual(changed(before, after), [], `off ${String(mode)}: nothing written`);
    assert.equal(await tickRaw(), undefined, `off ${String(mode)}: no tick`);
    assert.equal(claims + dials, 0, `off ${String(mode)}: no claim, no dial`);
    assert.ok("mode" in r && r.mode === "off");
  }
  console.log("  ok off (unset, '', 'off', 'yes'): no tick, every table unchanged, 0 claims, 0 dials");

  // 2. DRY: the tick is written (mode + counts, no PII); nothing claimed or dialled.
  await seed();
  for (const source of ["cron", "start"] as const) {
    reset();
    const before = await allTables();
    const r = await dispatchDueJobs(10, source, deps("dry"));
    const after = await allTables();
    assert.equal(claims, 0, "dry: claim never called");
    assert.equal(dials, 0, "dry: dialer never called");
    assert.equal(g.__campgateDials!.length, 0, "dry: the dial module never reached");
    assert.equal(after.campaign_contacts, before.campaign_contacts, "dry: campaign_contacts unchanged");
    assert.deepEqual(changed(before, after), ["app_settings"], "dry: only app_settings (the tick) changes");
    assert.ok("mode" in r && r.mode === "dry" && r.claimed === 0 && r.dialed === 0);
    const raw = await tickRaw();
    assert.ok(raw, "dry: tick written");
    const tick = JSON.parse(raw!);
    assert.ok(!Number.isNaN(Date.parse(tick.at)));
    const { at: _at, ...rest } = tick;
    assert.deepEqual(rest, {
      source,
      mode: "dry",
      claimed: 0,
      dialed: 0,
      failed: 0,
      runningCampaigns: 2,
      wouldDial: { campaignsDue: 1, contactsDue: 2, skippedCallHours: 1, skippedConcurrency: 1 },
    });
    // No number, name, campaign title or id in the tick.
    for (const pii of ["+1555", "Mock", OPEN_TITLE, CLOSED_TITLE, OPEN, CLOSED, TENANT, "0000-4000"])
      assert.ok(!raw!.includes(pii), `dry tick carries no ${pii}`);
    assert.ok(!/\d{8,}/.test(raw!.replace(tick.at, "")), "dry tick: no long digit run (phone number)");
  }
  const contacts = await rows(sql`SELECT status, attempts, claimed_at FROM campaign_contacts`);
  assert.ok(contacts.every((c) => c.status === "queued" && c.attempts === 0 && c.claimed_at === null), "dry: every contact still queued, 0 attempts");
  console.log("  ok dry (cron + start): tick { mode:'dry', claimed/dialed/failed 0, runningCampaigns, wouldDial counts }, no PII; 0 claims, 0 dials, campaign_contacts unchanged, only app_settings written");

  // 3. ON: dials (injected dialer) and the tick gains mode "on".
  await seed();
  reset();
  const on = await dispatchDueJobs(10, "cron", deps("on"));
  assert.deepEqual(on, { claimed: 2, dialed: 2, failed: 0 }, "on: result shape unchanged");
  assert.equal(dials, 2);
  const onTick = JSON.parse((await tickRaw())!);
  const { at: _onAt, ...onRest } = onTick;
  assert.deepEqual(onRest, { source: "cron", mode: "on", claimed: 2, dialed: 2, failed: 0, runningCampaigns: 2 });
  assert.deepEqual(Object.keys(onTick), ["at", "source", "claimed", "dialed", "failed", "mode", "runningCampaigns"]);
  console.log(`  ok on: 2 dialled (injected dialer), tick ${JSON.stringify(onRest)}`);

  // 4. GET /api/dashboard/campaigns carries dispatchMode (self + admin ?asUserId),
  //    the other keys unchanged.
  await seed();
  const read = async (p: Promise<Response> | Response) => {
    const res = await p;
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const listAs = async (session: string, qs = "") => {
    g.__campgateSession = { user: { id: session, email: `${session}@example.test` } };
    return read(list.GET(new NextRequest(`${B}/api/dashboard/campaigns${qs}`, { method: "GET" })));
  };
  const baseline: Record<string, string> = {};
  for (const mode of [undefined, "dry", "on"] as const) {
    if (mode === undefined) delete process.env.CAMPAIGN_DISPATCH;
    else process.env.CAMPAIGN_DISPATCH = mode;
    const want = mode ?? "off";
    for (const [who, session, qs] of [
      ["tenant", TENANT, ""],
      ["adminAs", ADMIN, `?asUserId=${TENANT}`],
      ["adminSelf", ADMIN, ""],
    ] as const) {
      const r = await listAs(session, qs);
      assert.equal(r.status, 200, `${who} ${want}`);
      assert.deepEqual(Object.keys(r.body), ["campaigns", "dispatchMode"], `${who} ${want}: keys`);
      assert.equal(r.body.dispatchMode, want, `${who}: dispatchMode ${want}`);
      assert.ok(!JSON.stringify(r.body).includes("CAMPAIGN_DISPATCH"), "no env name in the body");
      const rest = JSON.stringify(r.body.campaigns);
      baseline[who] ??= rest;
      assert.equal(rest, baseline[who], `${who}: campaigns byte-identical across modes`);
    }
  }
  assert.equal((JSON.parse(baseline.tenant) as unknown[]).length, 2);
  assert.equal((JSON.parse(baseline.adminSelf) as unknown[]).length, 0);
  g.__campgateSession = null;
  assert.equal((await read(list.GET(new NextRequest(`${B}/api/dashboard/campaigns`, { method: "GET" })))).status, 401);
  console.log("  ok list GET: dispatchMode off/dry/on for the tenant, admin ?asUserId and admin self; campaigns byte-identical; 401 signed out");

  // 5. The live snapshot: dispatcher.dispatchMode "dry" and the dry tick as lastTick.
  process.env.CAMPAIGN_DISPATCH = "dry";
  await dispatchDueJobs(10, "cron", { ...deps(undefined), env: process.env });
  g.__campgateSession = { user: { id: ADMIN, email: "admin@example.test" } };
  const snap = await read(
    live.GET(new NextRequest(`${B}/api/dashboard/campaigns/${OPEN}/live`, { method: "GET" }), { params: Promise.resolve({ id: OPEN }) }),
  );
  assert.equal(snap.status, 200);
  const dispatcher = snap.body.dispatcher as { dispatchMode: string; lastTick: { mode: string; wouldDial: unknown } | null };
  assert.equal(dispatcher.dispatchMode, "dry");
  assert.equal(dispatcher.lastTick?.mode, "dry", "the console sees a tick in dry: no 'never ran' alarm");
  assert.deepEqual(dispatcher.lastTick?.wouldDial, { campaignsDue: 1, contactsDue: 2, skippedCallHours: 1, skippedConcurrency: 1 });
  process.env.CAMPAIGN_DISPATCH = "on";
  const snapOn = await read(
    live.GET(new NextRequest(`${B}/api/dashboard/campaigns/${OPEN}/live`, { method: "GET" }), { params: Promise.resolve({ id: OPEN }) }),
  );
  assert.equal((snapOn.body.dispatcher as { dispatchMode: string }).dispatchMode, "on");
  delete process.env.CAMPAIGN_DISPATCH;
  console.log("  ok live snapshot: dispatcher.dispatchMode 'dry' with lastTick.mode 'dry' (+ counts); 'on' when on");

  assert.equal(g.__campgateDials!.length, 0, "the dial module was never reached");
  console.log("ALL CAMPAIGN DISPATCH TICK DB TESTS PASSED");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
