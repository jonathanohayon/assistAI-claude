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
  for (const source of ["cron", "start"] as const) {
    // From an empty app_settings each time (an unscoped start computes every
    // campaign, so it writes the whole tick; a start SCOPED to one campaign
    // merges into a stored dry tick: section 6).
    await seed();
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
    assert.ok(!JSON.stringify(r).includes("byCampaign") && !JSON.stringify(r).includes(OPEN), "dry result (cron response): global counts only, no campaign id");
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
      wouldDial: {
        campaignsDue: 1,
        contactsDue: 2,
        skippedCallHours: 1,
        skippedConcurrency: 1,
        // OPEN: 3 due, concurrency 2 → 2 now, 1 held; CLOSED: out of hours, 1 held.
        byCampaign: {
          [OPEN]: { due: 2, heldByHours: 0, heldByConcurrency: 1 },
          [CLOSED]: { due: 0, heldByHours: 1, heldByConcurrency: 0 },
        },
      },
    });
    // No number, name, title or tenant id; campaign ids only as byCampaign keys.
    for (const pii of ["+1555", "Mock", OPEN_TITLE, CLOSED_TITLE, TENANT])
      assert.ok(!raw!.includes(pii), `dry tick carries no ${pii}`);
    const noIds = JSON.stringify({ ...tick, wouldDial: { ...tick.wouldDial, byCampaign: Object.values(tick.wouldDial.byCampaign) } });
    assert.ok(!noIds.includes("0000-4000"), "dry tick: campaign ids nowhere but the byCampaign keys");
    assert.ok(!/\d{8,}/.test(noIds.replace(tick.at, "")), "dry tick: no long digit run (phone number)");
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
  //    A second tenant's running campaign is in the same global tick.
  const TENANT_B = id(0xb2);
  const B_OPEN = id(0xc3); // tenant B: running, 24/7, concurrency 5, 4 due
  await db.execute(sql`INSERT INTO users (id, email, password_hash, role, subscription_plan) VALUES
    (${TENANT_B}, 'tenant-b@example.test', 'x', 'user', 'global')`);
  await db.execute(sql`INSERT INTO campaigns (id, user_id, name, status, from_number, concurrency, call_window) VALUES
    (${B_OPEN}, ${TENANT_B}, 'Mock B Campaign', 'running', '+15550100002', 5,
     ${JSON.stringify({ timezone: "UTC", days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24 })}::jsonb)`);
  await db.execute(sql`INSERT INTO campaign_contacts (campaign_id, user_id, phone_number, contact_name) VALUES
    (${B_OPEN}, ${TENANT_B}, '+15550109101', 'Mock B1'), (${B_OPEN}, ${TENANT_B}, '+15550109102', 'Mock B2'),
    (${B_OPEN}, ${TENANT_B}, '+15550109103', 'Mock B3'), (${B_OPEN}, ${TENANT_B}, '+15550109104', 'Mock B4')`);
  process.env.CAMPAIGN_DISPATCH = "dry";
  reset();
  const beforeDry = await allTables();
  await dispatchDueJobs(10, "cron", { ...deps(undefined), env: process.env });
  assert.equal(claims + dials, 0, "dry (two tenants): no claim, no dial");
  assert.deepEqual(changed(beforeDry, await allTables()), ["app_settings"], "dry (two tenants): only the tick written");
  const stored = JSON.parse((await tickRaw())!);
  assert.deepEqual(stored.wouldDial.byCampaign[B_OPEN], { due: 4, heldByHours: 0, heldByConcurrency: 0 }, "B's entry is stored");
  const liveAs = async (session: string, campaignId: string, qs = "") => {
    g.__campgateSession = { user: { id: session, email: `${session}@example.test` } };
    const res = await live.GET(new NextRequest(`${B}/api/dashboard/campaigns/${campaignId}/live${qs}`, { method: "GET" }), {
      params: Promise.resolve({ id: campaignId }),
    });
    const text = await res.text();
    return { status: res.status, text, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
  };
  // Admin (self and ?asUserId): the full stored tick, every campaign's entry.
  for (const qs of ["", `?asUserId=${TENANT}`]) {
    const snap = await liveAs(ADMIN, OPEN, qs);
    assert.equal(snap.status, 200, `admin ${qs}`);
    const dispatcher = snap.body.dispatcher as { dispatchMode: string; lastTick: Record<string, unknown> | null };
    assert.equal(dispatcher.dispatchMode, "dry");
    assert.equal(dispatcher.lastTick?.mode, "dry", "the console sees a tick in dry: no 'never ran' alarm");
    assert.deepEqual(dispatcher.lastTick, stored, "admin: the stored tick as is");
    assert.equal(dispatcher.lastTick?.runningCampaigns, 3);
    assert.deepEqual((dispatcher.lastTick?.wouldDial as { contactsDue: number }).contactsDue, 6);
  }
  // Tenants: the route is admin-only (403, an error body only), so neither
  // tenant ever reads the global tick, A's or B's campaign alike.
  for (const [who, session, campaignId] of [
    ["A on A", TENANT, OPEN],
    ["B on A", TENANT_B, OPEN],
    ["B on B", TENANT_B, B_OPEN],
  ] as const) {
    const r = await liveAs(session, campaignId);
    assert.equal(r.status, 403, `tenant ${who}: 403`);
    assert.deepEqual(r.body, { error: "forbidden" }, `tenant ${who}: error body only`);
    for (const leak of [OPEN, CLOSED, B_OPEN, "runningCampaigns", "byCampaign", "wouldDial"])
      assert.ok(!r.text.includes(leak), `tenant ${who}: body never carries ${leak}`);
  }
  // The tenant scoping of that very stored tick (tickForViewer, what a
  // non-admin viewer would get): A's entry only, never B's id or counts.
  const { tickForViewer } = await import("../../lib/campaigns/live");
  const aView = JSON.stringify(tickForViewer(stored, OPEN, false));
  assert.deepEqual(JSON.parse(aView).wouldDial, { byCampaign: { [OPEN]: { due: 2, heldByHours: 0, heldByConcurrency: 1 } } });
  for (const leak of [B_OPEN, CLOSED, TENANT_B, "runningCampaigns", "contactsDue", "campaignsDue", "skippedCallHours", "skippedConcurrency", '"due":4'])
    assert.ok(!aView.includes(leak), `tenant A's view never carries ${leak}`);
  process.env.CAMPAIGN_DISPATCH = "on";
  const snapOn = await liveAs(ADMIN, OPEN);
  assert.equal((snapOn.body.dispatcher as { dispatchMode: string }).dispatchMode, "on");
  delete process.env.CAMPAIGN_DISPATCH;
  console.log("  ok live snapshot: admin (self + ?asUserId) gets the full stored tick (byCampaign of both tenants); tenants 403 with no tick; tickForViewer(A) carries only A's entry; 'on' when on");

  // 6. A dry START scoped to one campaign MERGES its entry into the stored dry
  //    tick: the other campaigns' entries, the globals, at / source /
  //    runningCampaigns stay the cron's. Atomic vs a concurrent cron tick.
  const seedTwoTenants = async () => {
    await seed();
    await db.execute(sql`INSERT INTO users (id, email, password_hash, role, subscription_plan) VALUES
      (${TENANT_B}, 'tenant-b@example.test', 'x', 'user', 'global')`);
    await db.execute(sql`INSERT INTO campaigns (id, user_id, name, status, from_number, concurrency, call_window) VALUES
      (${B_OPEN}, ${TENANT_B}, 'Mock B Campaign', 'running', '+15550100002', 5,
       ${JSON.stringify({ timezone: "UTC", days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24 })}::jsonb)`);
    await db.execute(sql`INSERT INTO campaign_contacts (campaign_id, user_id, phone_number, contact_name) VALUES
      (${B_OPEN}, ${TENANT_B}, '+15550109101', 'Mock B1'), (${B_OPEN}, ${TENANT_B}, '+15550109102', 'Mock B2'),
      (${B_OPEN}, ${TENANT_B}, '+15550109103', 'Mock B3'), (${B_OPEN}, ${TENANT_B}, '+15550109104', 'Mock B4')`);
  };
  // A parsed tick, navigated freely by the assertions below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type StoredTick = Record<string, any>;
  const tick = async () => JSON.parse((await tickRaw())!) as StoredTick;
  const startDry = (campaignId: string) => dispatchDueJobs(10, "start", deps("dry"), { campaignId });
  const cronDry = () => dispatchDueJobs(10, "cron", deps("dry"));
  const withoutAt = (e: Record<string, unknown>) => {
    const { at: _a, ...rest } = e;
    return rest;
  };

  // 6a. A cron tick with OPEN, CLOSED and B, then a dry start of OPEN (now 1 due):
  //     B's entry (and CLOSED's) and the globals are intact, OPEN's updated.
  await seedTwoTenants();
  reset();
  await cronDry();
  const cronTick = await tick();
  assert.deepEqual(Object.keys(cronTick.wouldDial.byCampaign).sort(), [OPEN, CLOSED, B_OPEN].sort());
  await db.execute(sql`UPDATE campaign_contacts SET status = 'completed'
    WHERE campaign_id = ${OPEN} AND phone_number IN ('+15550109001', '+15550109002')`);
  const beforeStart = await allTables();
  await startDry(OPEN);
  assert.deepEqual(changed(beforeStart, await allTables()), ["app_settings"], "dry start: only the tick written");
  assert.equal(claims + dials, 0, "dry start: no claim, no dial");
  const afterStart = await tick();
  const openEntry = afterStart.wouldDial.byCampaign[OPEN];
  assert.deepEqual(withoutAt(openEntry), { due: 1, heldByHours: 0, heldByConcurrency: 0 }, "OPEN's entry updated");
  assert.ok(!Number.isNaN(Date.parse(openEntry.at)) && openEntry.at >= cronTick.at, "OPEN's entry stamped with the start's own at");
  assert.deepEqual(afterStart.wouldDial.byCampaign[B_OPEN], { due: 4, heldByHours: 0, heldByConcurrency: 0 }, "B's entry still there");
  assert.deepEqual(afterStart.wouldDial.byCampaign[CLOSED], cronTick.wouldDial.byCampaign[CLOSED], "CLOSED's entry still there");
  const strip = (t: StoredTick) => ({ ...t, wouldDial: { ...t.wouldDial, byCampaign: undefined } });
  assert.deepEqual(strip(afterStart), strip(cronTick), "at, source, runningCampaigns and the globals: the cron's");
  // tickForViewer on the merged row: B's tenant sees only B, A's tenant only OPEN.
  const bView = JSON.stringify(tickForViewer(afterStart as never, B_OPEN, false));
  assert.deepEqual(JSON.parse(bView).wouldDial, { byCampaign: { [B_OPEN]: { due: 4, heldByHours: 0, heldByConcurrency: 0 } } });
  for (const leak of [OPEN, CLOSED, "contactsDue", "runningCampaigns"]) assert.ok(!bView.includes(leak), `B's view never carries ${leak}`);
  assert.deepEqual(JSON.parse(JSON.stringify(tickForViewer(afterStart as never, OPEN, false))).wouldDial, { byCampaign: { [OPEN]: openEntry } });
  console.log("  ok dry start after a cron tick: OPEN's entry updated (+ its own at), B's and CLOSED's entries and the globals intact; tickForViewer scoped");

  // 6b. A start of a campaign now at raw due 0: its entry removed, the others intact.
  await db.execute(sql`UPDATE campaign_contacts SET status = 'completed' WHERE campaign_id = ${OPEN}`);
  await startDry(OPEN);
  const afterZero = await tick();
  assert.deepEqual(Object.keys(afterZero.wouldDial.byCampaign).sort(), [CLOSED, B_OPEN].sort(), "OPEN removed, B and CLOSED kept");
  assert.deepEqual(afterZero.wouldDial.byCampaign[B_OPEN], { due: 4, heldByHours: 0, heldByConcurrency: 0 });
  assert.deepEqual(strip(afterZero), strip(cronTick));
  console.log("  ok dry start at due 0: its entry removed, the others and the globals intact");

  // 6c. No stored tick: a fresh dry tick with just the start's entry.
  await seedTwoTenants();
  await startDry(OPEN);
  const freshStart = await tick();
  assert.equal(freshStart.source, "start");
  assert.equal(freshStart.mode, "dry");
  assert.deepEqual(Object.keys(freshStart.wouldDial.byCampaign), [OPEN]);
  assert.equal(freshStart.wouldDial.byCampaign[OPEN].at, freshStart.at);
  assert.equal(freshStart.wouldDial.contactsDue, 2, "fresh start: its own counts as the globals (as before)");
  console.log("  ok dry start with no stored tick: a fresh dry tick, its entry only");

  // 6d. After an "on" tick: a fresh dry tick (an on tick has no dry entries to merge into).
  await seedTwoTenants();
  await dispatchDueJobs(10, "cron", deps("on"));
  assert.equal((await tick()).mode, "on");
  await db.execute(sql`UPDATE campaign_contacts SET status = 'queued', claimed_at = NULL, attempts = 0`);
  await startDry(B_OPEN);
  const afterOn = await tick();
  assert.equal(afterOn.mode, "dry");
  assert.equal(afterOn.source, "start");
  assert.deepEqual(Object.keys(afterOn.wouldDial.byCampaign), [B_OPEN]);
  assert.equal(afterOn.claimed, 0, "nothing of the on tick kept");
  console.log("  ok dry start after an 'on' tick: a fresh dry tick");

  // 6e. Deterministic interleaving: a cron write holds the row lock while the
  //     start runs; the start waits, then merges onto the cron's (newer) tick.
  await seedTwoTenants();
  reset();
  await cronDry();
  const marker: StoredTick = { ...(await tick()), at: new Date(Date.now() + 1000).toISOString(), runningCampaigns: 99 };
  let startDone = false;
  let startP: Promise<unknown> | null = null;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT value FROM app_settings WHERE key = ${DISPATCH_TICK_KEY} FOR UPDATE`);
    startP = startDry(OPEN).then(() => {
      startDone = true;
    });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(startDone, false, "the start waits on the row lock");
    await tx.execute(sql`UPDATE app_settings SET value = ${JSON.stringify(marker)} WHERE key = ${DISPATCH_TICK_KEY}`);
  });
  await startP;
  const interleaved = await tick();
  assert.equal(interleaved.runningCampaigns, 99, "the start merged onto the cron's committed tick");
  assert.equal(interleaved.at, marker.at);
  assert.deepEqual(interleaved.wouldDial.byCampaign[B_OPEN], marker.wouldDial.byCampaign[B_OPEN], "B's entry still there");
  assert.ok(typeof interleaved.wouldDial.byCampaign[OPEN].at === "string", "OPEN's entry is the start's");
  // And the other order: a cron tick after the start replaces the whole tick (fresher).
  await cronDry();
  const replaced = await tick();
  assert.equal(replaced.source, "cron");
  assert.equal(replaced.runningCampaigns, 3);
  assert.ok(Object.values(replaced.wouldDial.byCampaign).every((e) => !("at" in (e as object))), "the cron's full tick, no start stamp");
  console.log("  ok interleaving: a start blocked by a cron's row lock merges onto the cron's tick (B kept); a later cron replaces the whole tick");

  // 6f. Start and cron in parallel, many times, with and without a stored row:
  //     the final tick is always the cron's (source cron, 3 running) with B,
  //     OPEN and CLOSED present; OPEN's entry either the cron's or the start's
  //     (same counts), never a start-only tick that lost B.
  await seedTwoTenants();
  for (let i = 0; i < 30; i++) {
    if (i % 2 === 0) await db.execute(sql`DELETE FROM app_settings WHERE key = ${DISPATCH_TICK_KEY}`);
    else await cronDry();
    await Promise.all([startDry(OPEN), cronDry()]);
    const t = await tick();
    const keys = Object.keys(t.wouldDial.byCampaign).sort();
    assert.deepEqual(keys, [OPEN, CLOSED, B_OPEN].sort(), `parallel #${i}: every entry present`);
    assert.equal(t.source, "cron", `parallel #${i}: the cron's tick`);
    assert.equal(t.runningCampaigns, 3);
    assert.deepEqual(t.wouldDial.byCampaign[B_OPEN], { due: 4, heldByHours: 0, heldByConcurrency: 0 }, `parallel #${i}: B intact`);
    assert.deepEqual(withoutAt(t.wouldDial.byCampaign[OPEN]), { due: 2, heldByHours: 0, heldByConcurrency: 1 }, `parallel #${i}: OPEN consistent`);
    assert.equal(t.wouldDial.contactsDue, 6, `parallel #${i}: the cron's globals`);
  }
  assert.equal(claims + dials, 0, "dry: no claim, no dial");
  console.log("  ok parallel start + cron x30 (with and without a stored row): always the cron's full tick, B never lost");

  assert.equal(g.__campgateDials!.length, 0, "the dial module was never reached");
  console.log("ALL CAMPAIGN DISPATCH TICK DB TESTS PASSED");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
