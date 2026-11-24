// The admin persona reset against a THROWAWAY Postgres, through the real
// routes (app/api/admin/users/[userId]/reset-persona/{route,undo/route}.ts):
//   1. gate cases: signed out 401, a tenant 403 (GET, POST, undo), nothing
//      written; an admin 200;
//   2. the reset writes neutralSeed(<the agent's language>) + DEFAULT_AGENT_NAME,
//      never the per-plan onboarding template (one is stored here, mock);
//      no first-customer fact in what is written;
//   3. other fields untouched: every other agent_configs column (and the
//      users row) is byte-identical;
//   4. the replaced values are stored EXACTLY (a phone number and an email
//      inside the prompt come back unmasked); the event carries no prompt text;
//   5. undo: bad body 400, unknown / another account's reset 404, restores
//      the exact values (row identical to before the reset, updated_at aside),
//      a second undo 409 already_undone; edited since the reset → 409
//      edited_since_reset naming the fields, force: true restores; only the
//      latest reset can be undone (409 not_latest_reset).
// The session is a test double (scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs).
// Plain `npm test` skips it. Run it with:  bash scripts/persona-reset-db.sh
// Only a 127.0.0.1/localhost URL is accepted; mock data only (example.test).

import assert from "node:assert/strict";

import { FIRST_CUSTOMER_FACTS } from "./first-customer-facts";

const url = process.env.PERSONA_RESET_DB_TEST_URL;
if (!url) {
  console.log("skip: persona reset DB part (no PERSONA_RESET_DB_TEST_URL — see scripts/persona-reset-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /^(LIVEKIT|TWILIO|RESEND|WHATSAPP|GOOGLE)|OPENAI|REALTIME_API_KEY|EMAIL_FROM|ADMIN_ALERT/i.test(k))) {
  throw new Error("refusing to run with provider env set");
}
if (!(globalThis as { __campgateHooks?: boolean }).__campgateHooks) throw new Error("module hooks missing: run through scripts/persona-reset-db.sh");
process.env.DATABASE_URL = url;
process.env.INTERNAL_SECRET = "mock-internal-secret";

const g = globalThis as { __campgateSession?: { user: { id: string } } | null };
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const TENANT = "00000000-0000-4000-8000-000000000071";
const TARGET = "00000000-0000-4000-8000-000000000072";
const OTHER = "00000000-0000-4000-8000-000000000073";
const MISSING = "00000000-0000-4000-8000-0000000000ff";

// Mock persona with a phone number and an email inside the text: the logger
// would mask those, the persona_resets snapshot must not.
const OLD = {
  instructions: "Tu es Mocka, de Mock Salon, rue Exemple 1. Appelez le +972500000000 ou owner@example.test.",
  greeting: "Bonjour, Mock Salon, c'est Mocka !",
  agentName: "Mocka",
};
const TEMPLATE = "MOCK PLAN TEMPLATE: Prestige, Ashdod le lundi, soins 60 min";

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { DEFAULT_AGENT_NAME, neutralSeed } = await import("../../lib/neutral-seed");
  const { SETTING_KEYS, setSetting } = await import("../../lib/settings");
  const resetRoute = await import("../../app/api/admin/users/[userId]/reset-persona/route");
  const undoRoute = await import("../../app/api/admin/users/[userId]/reset-persona/undo/route");

  const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
  const ctx = (userId: string) => ({ params: Promise.resolve({ userId }) });
  const as = (id: string | null) => (g.__campgateSession = id ? { user: { id } } : null);
  const req = (body?: unknown) =>
    new NextRequest("http://localhost/api/admin/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? "{}" : typeof body === "string" ? body : JSON.stringify(body),
    });
  const post = async (userId: string) => {
    const r = await resetRoute.POST(new Request("http://localhost/x", { method: "POST" }), ctx(userId));
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const get = async (userId: string) => {
    const r = await resetRoute.GET(new Request("http://localhost/x"), ctx(userId));
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const undo = async (userId: string, body?: unknown) => {
    const r = await undoRoute.POST(req(body), ctx(userId));
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  // The whole agent_configs row as JSON, optionally without some columns.
  const cfgRow = async (userId: string, drop: string[] = []) => {
    const [r] = await rows<{ j: Record<string, unknown> }>(sql`SELECT to_jsonb(a) AS j FROM agent_configs a WHERE user_id = ${userId}`);
    const j = { ...r.j };
    for (const k of drop) delete j[k];
    return JSON.stringify(j);
  };
  const usersRow = async (userId: string) => JSON.stringify((await rows(sql`SELECT to_jsonb(u) AS j FROM users u WHERE id = ${userId}`))[0]);
  const resetCount = async () => Number((await rows<{ n: string }>(sql`SELECT count(*)::text AS n FROM persona_resets`))[0].n);
  const PERSONA_COLS = ["instructions", "greeting_instructions", "agent_name", "persona_config", "updated_at"];

  // ── Mock accounts ────────────────────────────────────────────────────────
  await db.execute(sql`INSERT INTO users (id, email, password_hash, role, locale, subscription_plan) VALUES
    (${ADMIN}, 'admin@persona-reset.example.test', 'x', 'admin', 'fr', 'global'),
    (${TENANT}, 'tenant@persona-reset.example.test', 'x', 'user', 'fr', 'global'),
    (${TARGET}, 'target@persona-reset.example.test', 'x', 'user', 'fr', 'premium'),
    (${OTHER}, 'other@persona-reset.example.test', 'x', 'user', 'en', 'global')`);
  // The target's agent speaks Hebrew while the account locale is fr: the reset
  // follows the agent's language.
  await db.execute(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, agent_name, voice, primary_language, owner_whatsapp, transfer_number, persona_config) VALUES
    (${TARGET}, ${OLD.instructions}, ${OLD.greeting}, ${OLD.agentName}, 'cedar', 'he', '+972500000001', '+97230000002',
     ${JSON.stringify({ version: 1, name: OLD.agentName, primaryLanguage: "he", greeting: { mode: "custom", text: OLD.greeting }, languages: ["en"], aiDisclosure: { enabled: true, text: "" } })}::jsonb),
    (${OTHER}, 'Other mock prompt', 'Other mock greeting', 'Otto', 'marin', 'en', '', '', NULL)`);
  // A per-plan onboarding template (mock first-customer text): must NOT be used.
  await setSetting(SETTING_KEYS.ONBOARDING_TEMPLATE_BY_PLAN, JSON.stringify({ premium: TEMPLATE, global: TEMPLATE }));
  await setSetting(SETTING_KEYS.ONBOARDING_GREETING_BY_PLAN, JSON.stringify({ premium: TEMPLATE, global: TEMPLATE }));

  const before = await cfgRow(TARGET);
  const beforeUser = await usersRow(TARGET);
  const otherBefore = await cfgRow(OTHER);

  // ── 1. Gate cases ────────────────────────────────────────────────────────
  for (const [who, code] of [[null, 401], [TENANT, 403]] as const) {
    as(who);
    assert.equal((await post(TARGET)).status, code, `reset as ${who ?? "signed out"}`);
    assert.equal((await get(TARGET)).status, code, `GET as ${who ?? "signed out"}`);
    assert.equal((await undo(TARGET, { resetId: MISSING })).status, code, `undo as ${who ?? "signed out"}`);
    assert.equal(await cfgRow(TARGET), before, "nothing written");
    assert.equal(await resetCount(), 0, "no reset row");
  }
  // A tenant resetting ITSELF is refused too.
  as(TENANT);
  assert.equal((await post(TENANT)).status, 403);
  console.log("ok 1 gate cases (401 signed out, 403 tenant, nothing written)");

  // ── 2. The reset ─────────────────────────────────────────────────────────
  as(ADMIN);
  assert.deepEqual((await get(TARGET)).body, { undo: null });
  assert.equal((await post(MISSING)).status, 404);
  assert.equal((await post("not-a-uuid")).status, 404);
  const r1 = await post(TARGET);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const seed = neutralSeed("he");
  const [cfg] = await rows<{ instructions: string; greeting_instructions: string; agent_name: string; persona_config: Record<string, unknown> }>(
    sql`SELECT instructions, greeting_instructions, agent_name, persona_config FROM agent_configs WHERE user_id = ${TARGET}`,
  );
  assert.equal(cfg.instructions, seed.instructions, "neutral instructions in the agent's language");
  assert.equal(cfg.greeting_instructions, seed.greeting, "neutral greeting in the agent's language");
  assert.equal(cfg.agent_name, DEFAULT_AGENT_NAME);
  for (const t of [cfg.instructions, cfg.greeting_instructions, cfg.agent_name]) {
    assert.doesNotMatch(t, FIRST_CUSTOMER_FACTS, "no first-customer fact written");
    assert.ok(!t.includes("MOCK PLAN TEMPLATE"), "the onboarding template is never used");
  }
  assert.equal(cfg.persona_config.name, DEFAULT_AGENT_NAME, "personaConfig follows the legacy columns");
  assert.deepEqual(cfg.persona_config.languages, ["en"], "personaConfig keeps the spoken languages");
  console.log("ok 2 reset writes the neutral persona (agent language he, account fr), never the plan template");

  // ── 3. Other fields untouched ────────────────────────────────────────────
  assert.equal(await cfgRow(TARGET, PERSONA_COLS), JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(before)).filter(([k]) => !PERSONA_COLS.includes(k)))));
  assert.equal(await usersRow(TARGET), beforeUser, "users row untouched");
  assert.equal(await cfgRow(OTHER), otherBefore, "another account untouched");
  console.log("ok 3 every other column, the users row and other accounts are unchanged");

  // ── 4. Stored exactly; the event carries no prompt ───────────────────────
  const [stored] = await rows<{ id: string; previous: Record<string, unknown>; by_admin: string; undone_at: string | null }>(
    sql`SELECT id, previous, by_admin, undone_at FROM persona_resets WHERE user_id = ${TARGET}`,
  );
  assert.equal(stored.id, r1.body.resetId);
  assert.equal(stored.by_admin, ADMIN);
  assert.equal(stored.undone_at, null);
  assert.equal(stored.previous.instructions, OLD.instructions, "phone + email kept verbatim");
  assert.equal(stored.previous.greetingInstructions, OLD.greeting);
  assert.equal(stored.previous.agentName, OLD.agentName);
  assert.deepEqual(stored.previous.personaConfig, JSON.parse(before).persona_config);
  const ev = await rows<{ source: string; metadata: Record<string, unknown> }>(sql`SELECT source, metadata FROM events WHERE event = 'persona_reset_neutral'`);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].source, "admin");
  assert.deepEqual(ev[0].metadata, { targetUserId: TARGET, resetId: stored.id, by: ADMIN });
  console.log("ok 4 previous values stored exactly in persona_resets; event = ids only");

  // ── 5. Undo ──────────────────────────────────────────────────────────────
  const avail = (await get(TARGET)).body.undo as { resetId: string; editedSinceReset: string[] };
  assert.equal(avail.resetId, stored.id);
  assert.deepEqual(avail.editedSinceReset, []);
  assert.equal((await undo(TARGET, "not json")).status, 400);
  assert.deepEqual((await undo(TARGET, {})).body, { error: "invalid_reset_id" });
  assert.deepEqual((await undo(TARGET, { resetId: stored.id, force: "yes" })).body, { error: "invalid_force" });
  assert.equal((await undo(TARGET, { resetId: MISSING })).status, 404);
  assert.equal((await undo(OTHER, { resetId: stored.id })).status, 404, "another account's reset");
  const u1 = await undo(TARGET, { resetId: stored.id });
  assert.equal(u1.status, 200, JSON.stringify(u1.body));
  assert.equal(await cfgRow(TARGET, ["updated_at"]), await (async () => {
    const j = JSON.parse(before);
    delete j.updated_at;
    return JSON.stringify(j);
  })(), "undo restores the exact row");
  assert.deepEqual((await undo(TARGET, { resetId: stored.id })).body, { error: "already_undone" });
  assert.deepEqual((await get(TARGET)).body, { undo: null });
  console.log("ok 5a undo restores exactly; bad body 400; unknown / other account 404; second undo 409");

  // Edited since the reset → refused, then forced.
  const r2 = await post(TARGET);
  assert.equal(r2.status, 200);
  await db.execute(sql`UPDATE agent_configs SET greeting_instructions = 'Mock later edit' WHERE user_id = ${TARGET}`);
  assert.deepEqual(((await get(TARGET)).body.undo as { editedSinceReset: string[] }).editedSinceReset, ["greetingInstructions"]);
  assert.deepEqual((await undo(TARGET, { resetId: r2.body.resetId })).body, { error: "edited_since_reset", fields: ["greetingInstructions"] });
  const [still] = await rows<{ g: string }>(sql`SELECT greeting_instructions AS g FROM agent_configs WHERE user_id = ${TARGET}`);
  assert.equal(still.g, "Mock later edit", "a refused undo writes nothing");
  const u2 = await undo(TARGET, { resetId: r2.body.resetId, force: true });
  assert.equal(u2.status, 200);
  assert.deepEqual(u2.body.overwritten, ["greetingInstructions"]);
  assert.equal(await cfgRow(TARGET, ["updated_at"]), JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(before)).filter(([k]) => k !== "updated_at"))));
  console.log("ok 5b edited since the reset → 409 naming the field; force restores");

  // Only the latest reset.
  const r3 = await post(TARGET);
  const r4 = await post(TARGET);
  assert.deepEqual((await undo(TARGET, { resetId: r3.body.resetId })).body, { error: "not_latest_reset" });
  assert.equal((await undo(TARGET, { resetId: r4.body.resetId })).status, 200);
  console.log("ok 5c only the latest reset can be undone");

  assert.equal(await cfgRow(OTHER), otherBefore, "another account untouched throughout");
  console.log("ALL PERSONA RESET DB TESTS PASSED");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
