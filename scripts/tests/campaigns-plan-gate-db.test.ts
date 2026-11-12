// The outbound call centre's plan gate + the test-call rate limit, through the
// REAL route handlers against a THROWAWAY Postgres. Only the session, the dial
// and (for the "entitled" actor) the plan grid's force-off are test doubles —
// see scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs. Nothing is dialled.
//
//   CAMPGATE_PHASE=main   → run the scenario on origin/main's tree, write a snapshot
//   CAMPGATE_PHASE=branch → admin + entitled plan: byte-identical to the snapshot;
//                           a plan without the feature: 403 on every gated route,
//                           nothing written; test-call limits (account, global, race).
// Run with:  bash scripts/campaigns-plan-gate-db.sh
// Skipped in a plain `npm test`. Mock data only (example.test, +1555 numbers).

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const url = process.env.CAMPGATE_DB_URL;
if (!url) {
  console.log("SKIPPED campaigns-plan-gate-db (run bash scripts/campaigns-plan-gate-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /^(LIVEKIT|TWILIO)/.test(k))) throw new Error("refusing to run with LiveKit/Twilio env set");
if (!(globalThis as { __campgateHooks?: boolean }).__campgateHooks) throw new Error("module hooks missing: run through scripts/campaigns-plan-gate-db.sh");
process.env.DATABASE_URL = url;
const PHASE = process.env.CAMPGATE_PHASE;
const SNAP = process.env.CAMPGATE_SNAPSHOT!;

type G = {
  __campgateSession?: { user: { id: string; email?: string } } | null;
  __campgateDials?: Array<Record<string, unknown>>;
  __campgateLiftForceOff?: boolean;
};
const g = globalThis as G;

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ADMIN = id(0xad);
const ENTITLED = id(0xe1); // plan "premium", grid grants outbound_campaigns (force-off lifted)
const PLAIN = id(0xb1); // plan "global": no outbound_campaigns
const PLAIN_AS = id(0xb2); // plan "global", target of the admin's ?asUserId
const PLAIN_CAMPAIGN = id(0xc1); // a legacy campaign PLAIN already owns
const PLAIN_AGENT = id(0xa1); // a legacy outbound agent PLAIN already owns
const FIXED = new Set([ADMIN, ENTITLED, PLAIN, PLAIN_AS, PLAIN_CAMPAIGN, PLAIN_AGENT]);
const B = "http://localhost";

type Res = { status: number; body: unknown; retryAfter: string | null };

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const exec = (q: ReturnType<typeof sql>) => db.execute(q);
  const rows = async (q: ReturnType<typeof sql>) => {
    const r = (await exec(q)) as unknown as unknown[] | { rows: unknown[] };
    return (Array.isArray(r) ? r : r.rows) as Record<string, unknown>[];
  };

  const R = {
    list: await import("../../app/api/dashboard/campaigns/route"),
    one: await import("../../app/api/dashboard/campaigns/[id]/route"),
    contacts: await import("../../app/api/dashboard/campaigns/[id]/contacts/route"),
    imp: await import("../../app/api/dashboard/campaigns/[id]/import/route"),
    status: await import("../../app/api/dashboard/campaigns/[id]/status/route"),
    testCall: await import("../../app/api/dashboard/campaigns/[id]/test-call/route"),
    results: await import("../../app/api/dashboard/campaigns/[id]/results/route"),
    learn: await import("../../app/api/dashboard/campaigns/learn/route"),
    agents: await import("../../app/api/dashboard/outbound-agents/route"),
    agent: await import("../../app/api/dashboard/outbound-agents/[id]/route"),
    liveTest: await import("../../app/api/live-test/token/route"),
  };

  async function seed() {
    await exec(sql`DELETE FROM events`);
    await exec(sql`DELETE FROM app_settings`);
    await exec(sql`DELETE FROM users`); // cascades to campaigns, contacts, agents, numbers
    await exec(sql`INSERT INTO users (id, email, password_hash, role, subscription_plan) VALUES
      (${ADMIN}, 'admin@example.test', 'x', 'admin', 'essential'),
      (${ENTITLED}, 'entitled@example.test', 'x', 'user', 'premium'),
      (${PLAIN}, 'plain@example.test', 'x', 'user', 'global'),
      (${PLAIN_AS}, 'plain-as@example.test', 'x', 'user', 'global')`);
    await exec(sql`INSERT INTO phone_numbers (user_id, phone_number) VALUES
      (${ADMIN}, '+15550100001'), (${ENTITLED}, '+15550100002'),
      (${PLAIN}, '+15550100003'), (${PLAIN_AS}, '+15550100004')`);
    // The stored grid grants the feature to "premium" only (the real
    // featuresForPlan ignores that since the 2026-11 grid; the double lifts it).
    const grid = JSON.stringify({ premium: { outbound_campaigns: true }, global: { outbound_campaigns: false } });
    await exec(sql`INSERT INTO app_settings (key, value) VALUES ('plan_features', ${grid})`);
    await exec(sql`INSERT INTO campaigns (id, user_id, name, status, from_number) VALUES
      (${PLAIN_CAMPAIGN}, ${PLAIN}, 'Legacy mock campaign', 'draft', '+15550100003')`);
    await exec(sql`INSERT INTO outbound_agents (id, user_id, name, agent_name, instructions) VALUES
      (${PLAIN_AGENT}, ${PLAIN}, 'Legacy Agent', 'Legacy Agent', 'Mock.')`);
    g.__campgateDials = [];
    g.__campgateLiftForceOff = true;
  }

  const as = (sessionUser: string) => {
    g.__campgateSession = { user: { id: sessionUser, email: `${sessionUser}@example.test` } };
  };
  const ctx = (cid: string) => ({ params: Promise.resolve({ id: cid }) });
  const req = (path: string, method: string, body?: unknown, qs = "") => {
    const u = `${B}${path}${qs}`;
    if (body instanceof FormData) return new NextRequest(u, { method, body });
    return new NextRequest(u, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
  };
  const read = async (p: Promise<Response> | Response): Promise<Res> => {
    const res = await p;
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, retryAfter: res.headers.get("retry-after") };
  };
  const csv = () => {
    const fd = new FormData();
    fd.append("file", new File(["phone,name\n+15550109002,Mock B\n"], "mock.csv", { type: "text/csv" }));
    return fd;
  };

  // Generated ids / timestamps differ between runs: replaced by placeholders
  // (ids by order of first appearance), everything else compared as is.
  function normalize(v: unknown): unknown {
    const ids = new Map<string, string>();
    const s = JSON.stringify(v)
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (m) => {
        if (FIXED.has(m)) return m;
        if (!ids.has(m)) ids.set(m, `<id${ids.size}>`);
        return ids.get(m)!;
      })
      .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:?\d\d)/g, "<ts>")
      .replace(/__test\d+/g, "__test<ms>");
    return JSON.parse(s);
  }

  // One full pass over every route for a session user acting on `target`.
  async function scenario(sessionUser: string, target: string) {
    as(sessionUser);
    const qs = sessionUser === target ? "" : `?asUserId=${target}`;
    const out: Record<string, Res> = {};
    const dialsBefore = g.__campgateDials!.length;
    out.create = await read(R.list.POST(req("/api/dashboard/campaigns", "POST", { name: "Mock campaign", objective: "Mock objective", fromNumber: "" }, qs)));
    const cid = (out.create.body as { campaign?: { id: string } })?.campaign?.id ?? PLAIN_CAMPAIGN;
    out.patch = await read(R.one.PATCH(req(`/api/dashboard/campaigns/${cid}`, "PATCH", { name: "Mock campaign 2" }, qs), ctx(cid)));
    out.contacts = await read(R.contacts.POST(req(`/api/dashboard/campaigns/${cid}/contacts`, "POST", { contacts: [{ phoneNumber: "+15550109001", contactName: "Mock A" }] }, qs), ctx(cid)));
    out.importCsv = await read(R.imp.POST(req(`/api/dashboard/campaigns/${cid}/import`, "POST", csv(), qs), ctx(cid)));
    out.importBad = await read(R.imp.POST(req(`/api/dashboard/campaigns/${cid}/import`, "POST", { source: "none" }, qs), ctx(cid)));
    out.start = await read(R.status.POST(req(`/api/dashboard/campaigns/${cid}/status`, "POST", { action: "start" }, qs), ctx(cid)));
    out.pause = await read(R.status.POST(req(`/api/dashboard/campaigns/${cid}/status`, "POST", { action: "pause" }, qs), ctx(cid)));
    out.testCall = await read(R.testCall.POST(req(`/api/dashboard/campaigns/${cid}/test-call`, "POST", { phoneNumber: "+15550109003" }, qs), ctx(cid)));
    out.results = await read(R.results.GET(req(`/api/dashboard/campaigns/${cid}/results`, "GET", undefined, qs), ctx(cid)));
    out.learn = await read(R.learn.POST(req("/api/dashboard/campaigns/learn", "POST", { urls: [] }, qs)));
    out.agentCreate = await read(R.agents.POST(req("/api/dashboard/outbound-agents", "POST", { agentName: "Mock Agent", instructions: "Mock." }, qs)));
    const aid = (out.agentCreate.body as { agent?: { id: string } })?.agent?.id ?? PLAIN_AGENT;
    out.agentPatch = await read(R.agent.PATCH(req(`/api/dashboard/outbound-agents/${aid}`, "PATCH", { agentName: "Mock Agent 2" }, qs), ctx(aid)));
    out.liveTestAgent = await read(R.liveTest.POST(req("/api/live-test/token", "POST", { agentId: aid, ...(qs ? { asUserId: target } : {}) })));
    out.liveTestInbound = await read(R.liveTest.POST(req("/api/live-test/token", "POST", qs ? { asUserId: target } : {})));
    out.listGet = await read(R.list.GET(req("/api/dashboard/campaigns", "GET", undefined, qs)));
    out.agentsGet = await read(R.agents.GET(req("/api/dashboard/outbound-agents", "GET", undefined, qs)));
    out.agentDelete = await read(R.agent.DELETE(req(`/api/dashboard/outbound-agents/${aid}`, "DELETE", undefined, qs), ctx(aid)));
    out.delete = await read(R.one.DELETE(req(`/api/dashboard/campaigns/${cid}`, "DELETE", undefined, qs), ctx(cid)));
    const dials = g.__campgateDials!.slice(dialsBefore).map((d) => ({ ...d }));
    return { responses: out, dials };
  }

  await seed();
  const run = {
    adminSelf: normalize(await scenario(ADMIN, ADMIN)),
    adminAs: normalize(await scenario(ADMIN, PLAIN_AS)),
    entitled: normalize(await scenario(ENTITLED, ENTITLED)),
    plain: normalize(await scenario(PLAIN, PLAIN)),
  };

  const statuses = (r: unknown) =>
    Object.fromEntries(Object.entries((r as { responses: Record<string, Res> }).responses).map(([k, v]) => [k, v.status]));

  if (PHASE === "main") {
    writeFileSync(SNAP, JSON.stringify(run));
    console.log("main statuses, plan WITHOUT the feature:", JSON.stringify(statuses(run.plain)));
    console.log("main dials by a plan WITHOUT the feature:", (run.plain as { dials: unknown[] }).dials.length);
    console.log("SNAPSHOT WRITTEN");
    process.exit(0);
  }
  assert.equal(PHASE, "branch");
  // The live-test token's signer-missing 500 was renamed to the neutral
  // "not_configured" (fix/web-token-limit): a deliberate change, not a gate
  // regression. A no-op once main carries it.
  const main = JSON.parse(readFileSync(SNAP, "utf8").replaceAll('"LiveKit not configured"', '"not_configured"')) as typeof run;

  // 1. Admin (own account and ?asUserId on a plan without the feature) and an
  //    entitled plan: byte-identical to main, dials included.
  for (const k of ["adminSelf", "adminAs", "entitled"] as const) {
    const a = JSON.stringify(main[k]);
    const b = JSON.stringify(run[k]);
    if (a !== b) {
      const ma = main[k] as { responses: Record<string, Res> };
      const rb = run[k] as { responses: Record<string, Res> };
      for (const key of Object.keys(ma.responses))
        if (JSON.stringify(ma.responses[key]) !== JSON.stringify(rb.responses[key]))
          console.error(`DIFF ${k}.${key}\n main  : ${JSON.stringify(ma.responses[key])}\n branch: ${JSON.stringify(rb.responses[key])}`);
    }
    assert.equal(b, a, `${k}: branch must be byte-identical to main`);
    console.log(`  ok ${k}: byte-identical to main (${a.length} bytes, ${(run[k] as { dials: unknown[] }).dials.length} dial(s)) ${JSON.stringify(statuses(run[k]))}`);
  }

  // 2. A plan without the feature: 403 on every gated route, nothing dialled.
  const refused = { status: 403, body: { error: "plan_feature_required", feature: "outbound_campaigns" }, retryAfter: null };
  const plain = run.plain as { responses: Record<string, Res>; dials: unknown[] };
  const gated = ["create", "patch", "contacts", "importCsv", "importBad", "start", "pause", "testCall", "results", "learn", "agentCreate", "agentPatch", "liveTestAgent", "agentDelete", "delete"];
  for (const k of gated) assert.deepEqual(plain.responses[k], refused, `plain ${k} → 403 plan_feature_required`);
  assert.equal(plain.dials.length, 0, "plain: nothing dialled");
  for (const k of ["listGet", "agentsGet"]) assert.equal(plain.responses[k].status, 200, `plain ${k} (read) unchanged`);
  assert.equal(plain.responses.liveTestInbound.status, (main.plain as { responses: Record<string, Res> }).responses.liveTestInbound.status, "inbound live test unchanged");
  console.log(`  ok plain: 403 plan_feature_required on ${gated.length} gated calls, 0 dials; reads + inbound live test unchanged`);
  // …and nothing was written for PLAIN: its legacy rows are as seeded.
  const [pc] = await rows(sql`SELECT count(*)::int AS n, max(name) AS name, max(status) AS status FROM campaigns WHERE user_id = ${PLAIN}`);
  assert.deepEqual({ ...pc }, { n: 1, name: "Legacy mock campaign", status: "draft" });
  const [pk] = await rows(sql`SELECT count(*)::int AS n FROM campaign_contacts WHERE user_id = ${PLAIN}`);
  assert.equal(pk.n, 0);
  const [pa] = await rows(sql`SELECT count(*)::int AS n, max(agent_name) AS name FROM outbound_agents WHERE user_id = ${PLAIN}`);
  assert.deepEqual({ ...pa }, { n: 1, name: "Legacy Agent" });
  console.log("  ok plain: no campaign/contact/agent row written or changed");

  // 3. Today's real grid (no double): the "premium" tenant is refused too.
  g.__campgateLiftForceOff = false;
  as(ENTITLED);
  const real = await read(R.list.POST(req("/api/dashboard/campaigns", "POST", { name: "Mock" })));
  assert.deepEqual(real, refused);
  as(ADMIN);
  assert.equal((await read(R.list.POST(req("/api/dashboard/campaigns", "POST", { name: "Mock" })))).status, 201);
  g.__campgateLiftForceOff = true;
  console.log("  ok real grid: premium refused (force-off), admin still 201");
  // Signed out stays 401 (the route's own check answers first).
  g.__campgateSession = null;
  assert.equal((await read(R.list.POST(req("/api/dashboard/campaigns", "POST", { name: "Mock" })))).status, 401);
  console.log("  ok signed out: 401");

  // 4. test-call limits (bucket test_call).
  const L = await import("../../lib/campaigns/test-call-limit");
  assert.equal(L.TEST_CALL_PER_ACCOUNT, 10);
  await exec(sql`DELETE FROM app_settings WHERE key = 'rate_limit:test_call'`);
  const tenants: string[] = [];
  const campaignOf = new Map<string, string>();
  for (let i = 0; i < 12; i++) {
    const t = id(0x1000 + i);
    tenants.push(t);
    campaignOf.set(t, id(0x2000 + i));
    await exec(sql`INSERT INTO users (id, email, password_hash, role, subscription_plan) VALUES (${t}, ${`t${i}@example.test`}, 'x', 'user', 'premium')`);
    await exec(sql`INSERT INTO campaigns (id, user_id, name, status, from_number) VALUES (${id(0x2000 + i)}, ${t}, 'Mock', 'draft', ${`+1555020${String(i).padStart(4, "0")}`})`);
  }
  const call = (t: string, viaAdmin = false) => {
    as(viaAdmin ? ADMIN : t);
    const c = campaignOf.get(t)!;
    return read(R.testCall.POST(req(`/api/dashboard/campaigns/${c}/test-call`, "POST", { phoneNumber: "+15550109003" }, viaAdmin ? `?asUserId=${t}` : ""), ctx(c)));
  };
  // 4a. sequential: 10 ok, the 11th → 429 account.
  let d0 = g.__campgateDials!.length;
  for (let i = 1; i <= 10; i++) assert.equal((await call(tenants[0])).status, 200, `call ${i}`);
  const eleventh = await call(tenants[0]);
  assert.equal(eleventh.status, 429);
  assert.deepEqual(eleventh.body, { error: "rate_limited", scope: "account" });
  assert.ok(Number(eleventh.retryAfter) > 0, "Retry-After set");
  assert.equal(g.__campgateDials!.length - d0, 10, "the refused call did not dial");
  const [c11] = await rows(sql`SELECT count(*)::int AS n FROM campaign_contacts WHERE user_id = ${tenants[0]}`);
  assert.equal(c11.n, 10, "the refused call wrote no test contact");
  console.log(`  ok account limit: 10 × 200, 11th → 429 scope account (Retry-After ${eleventh.retryAfter}s), 10 dials`);
  // An admin acting for that tenant counts on the tenant's account too.
  assert.deepEqual((await call(tenants[0], true)).body, { error: "rate_limited", scope: "account" });
  console.log("  ok admin ?asUserId on that tenant → 429 account (counted on the target account)");
  // 4b. race: 15 concurrent on a fresh account → exactly 10 pass.
  d0 = g.__campgateDials!.length;
  const race = await Promise.all(Array.from({ length: 15 }, () => call(tenants[1])));
  // `as()` is shared state: every call in the race uses tenants[1]'s session.
  const ok = race.filter((r) => r.status === 200).length;
  const limited = race.filter((r) => r.status === 429 && (r.body as { scope: string }).scope === "account").length;
  assert.equal(ok, 10);
  assert.equal(limited, 5);
  assert.equal(g.__campgateDials!.length - d0, 10);
  console.log("  ok race: 15 concurrent → 10 × 200, 5 × 429 account, 10 dials");
  // 4c. global ceiling: 100 per hour across accounts.
  assert.equal(L.TEST_CALL_GLOBAL, 100);
  for (let k = 2; k < 10; k++) for (let i = 0; i < 10; i++) assert.equal((await call(tenants[k])).status, 200);
  d0 = g.__campgateDials!.length;
  const over = await call(tenants[10]);
  assert.equal(over.status, 429);
  assert.deepEqual(over.body, { error: "rate_limited", scope: "global" });
  assert.equal(g.__campgateDials!.length, d0, "no dial over the ceiling");
  console.log("  ok global ceiling: 100 accepted in the hour, the 101st (fresh account) → 429 scope global");

  console.log("ALL CAMPAIGNS PLAN GATE DB TESTS PASSED");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
