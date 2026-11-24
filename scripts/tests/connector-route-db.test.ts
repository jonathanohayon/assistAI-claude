// Number → connector routing (B2) against a THROWAWAY Postgres, through the
// real inbound handler (buildInboundConfig, the code /api/agent/config and
// /api/agent/session-config run):
//   1. zero connector rows + the account-level agent ON: the account's
//      clientAgent on every number, byte-identical to the routing BYPASSED
//      (connectorDeps null: the pre-B2 path, no lookup);
//   2. an account with 2 numbers + 1 enabled connector on number B: a call to
//      B serves the connector's clientAgent (url / mode / the sealed secret
//      opened), the rest of the payload is the account's; a call to A serves
//      NO clientAgent although the account-level agent is ON; a web call
//      (userId) none either;
//   3. the connector OFF → no clientAgent on B (= the call on A, byte for byte);
//   4. its voice_config served when set (voiceConfig + the legacy voice fields);
//   5. a secret that can't be opened → not served (reported); no secret → not
//      served + the deduped alert; an unsafe url → not served;
//   6. throw injection at each read / a bad row → the response is
//      byte-identical to the "reception" response + ONE connector_route_failed
//      alert (daily); an alert sink that throws changes nothing;
//   7. never served: the connector's name, id and test results;
//   8. a soft-deleted connector (deleted_at set) never routes, even with its
//      number still on the row: a call to B → reception (another live
//      connector on A); deleted rows only → zero live rows → legacy.
// No DNS (injected resolver), no provider call. Plain `npm test` skips it.
// Run it with:  bash scripts/connector-route-db.sh
// Only a 127.0.0.1/localhost URL is accepted; mock data only (example.com, +1555).

import assert from "node:assert/strict";

const url = process.env.CONNECTOR_ROUTE_DB_TEST_URL;
if (!url) {
  console.log("skip: connector route DB part (no CONNECTOR_ROUTE_DB_TEST_URL — see scripts/connector-route-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /^(LIVEKIT|TWILIO|RESEND|WHATSAPP|GOOGLE)|OPENAI|REALTIME_API_KEY|EMAIL_FROM|AGENT_WEBHOOK/i.test(k))) {
  throw new Error("refusing to run with provider env set");
}
process.env.DATABASE_URL = url;
process.env.INTERNAL_SECRET = "mock-internal-secret";
process.env.CLIENT_AGENT = "all";
// Mock sealing keys (32 zero / one bytes): never a real key.
const KEY_1 = Buffer.alloc(32, 1).toString("base64");
const KEY_2 = Buffer.alloc(32, 2).toString("base64");
process.env.SECRETS_KEY = KEY_1;
process.env.SECRETS_KEY_ID = "mock1";

const ACC = "00000000-0000-4000-8000-0000000b2001";
const PA = "+15550000101";
const PB = "+15550000102";
const ACCOUNT_HOOK = "https://account.example.com/hook";
const BOT_HOOK = "https://bot.example.com/hook";
const CONNECTOR_NAME = "Mock Bot B2";
const ACCOUNT_SECRET = "mock-account-secret";
const CONNECTOR_SECRET = "mock-connector-secret";

async function main() {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../../lib/db");
  const { buildInboundConfig, DRY_INBOUND_EFFECTS } = await import("../../lib/agent/session-config/inbound");
  const { sealSecret } = await import("../../lib/crypto/secret-box");
  const { connectorRouteFailedAlertKey, connectorNoSecretAlertKey } = await import("../../lib/connectors/route-load");
  const { servedConnectorVoice } = await import("../../lib/connectors/route");
  const { DEFAULT_VOICE } = await import("../../lib/voice/contract");
  type Effects = typeof DRY_INBOUND_EFFECTS;

  // ── Fixture: one account, two numbers, the account-level agent ON ──────
  await db.execute(sql`DELETE FROM users WHERE id = ${ACC}`);
  await db.execute(sql`INSERT INTO users (id, email, password_hash, display_name, subscription_plan, subscription_status)
    VALUES (${ACC}, 'b2@connector-route.example.com', 'x', 'Route Mock', 'premium', 'active')`);
  const tools = {
    version: 1,
    booking: { enabled: true, defaultDurationMinutes: null, minNoticeMinutes: null },
    contacts: { enabled: true },
    transfer: { enabled: false, when: "always" },
    orders: { enabled: false, ask: "" },
    clientAgent: { enabled: true, url: ACCOUNT_HOOK, mode: "lead", secret: ACCOUNT_SECRET },
  };
  await db.execute(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, agent_name, voice, primary_language, tools_config)
    VALUES (${ACC}, 'Mock instructions.', 'Hello, Mock here.', 'Mock', 'marin', 'en', ${JSON.stringify(tools)}::jsonb)`);
  await db.execute(sql`INSERT INTO phone_numbers (user_id, phone_number) VALUES (${ACC}, ${PA}), (${ACC}, ${PB})`);
  const [{ id: PB_ID }] = (await db.execute(sql`SELECT id FROM phone_numbers WHERE phone_number = ${PB}`)) as unknown as Array<{ id: string }>;

  // ── Effects: everything captured, no DNS (a public mock address) ──────
  const alerts: Array<{ key: string; dedupMs: number }> = [];
  const events: Array<{ event: string; metadata?: Record<string, unknown> }> = [];
  const unreadable: string[] = [];
  const fx = (over: Partial<Effects> = {}): Effects => ({
    ...DRY_INBOUND_EFFECTS,
    logEvent: (async (e: { event: string; metadata?: Record<string, unknown> }) => {
      events.push(e);
    }) as unknown as Effects["logEvent"],
    alertAdmins: async (a) => {
      alerts.push(a as { key: string; dedupMs: number });
      return true;
    },
    reportUnreadable: (kind) => {
      unreadable.push(kind);
    },
    // internal.example.com stands for a name that resolves to a private address.
    urlCheck: { resolver: async (h) => [{ address: h === "internal.example.com" ? "10.0.0.1" : "93.184.216.34", family: 4 }] },
    ...over,
  });
  const reset = () => {
    alerts.length = 0;
    events.length = 0;
    unreadable.length = 0;
  };
  const call = async (q: Record<string, string>, f: Effects = fx()) => {
    const res = await buildInboundConfig(new URLSearchParams(q), f);
    assert.equal(res.status, 200, `status for ${JSON.stringify(q)}`);
    // Let fire-and-forget sinks run.
    await new Promise((r) => setImmediate(r));
    return (await res.text()).replace(/"updatedAt":"[^"]+"/g, '"updatedAt":"*"');
  };
  const parse = (t: string) => JSON.parse(t) as Record<string, unknown>;
  const without = (t: string, k: string) => {
    const o = parse(t);
    delete o[k];
    return JSON.stringify(o);
  };
  const onA = { phone: PA };
  const onB = { phone: PB };
  const web = { userId: ACC };

  // ── 1. Zero rows: today's payload, identical to the routing bypassed ───
  const zeroA = await call(onA);
  const zeroB = await call(onB);
  const zeroWeb = await call(web);
  assert.equal(zeroA, await call(onA, fx({ connectorDeps: null })), "zero rows on A = bypassed");
  assert.equal(zeroB, await call(onB, fx({ connectorDeps: null })), "zero rows on B = bypassed");
  assert.equal(zeroWeb, await call(web, fx({ connectorDeps: null })), "zero rows on web = bypassed");
  assert.deepEqual(parse(zeroA).clientAgent, { url: ACCOUNT_HOOK, secret: ACCOUNT_SECRET, mode: "lead" }, "the account-level agent");
  assert.equal(zeroA, zeroB, "zero rows: every number gets the account's agent");
  assert.ok(!events.some((e) => e.event === "connector_route"), "zero rows: no route event");
  assert.equal(alerts.length, 0);
  console.log("ok: 1. zero rows + account agent ON = today's payload (= routing bypassed), on A, B and web");

  // ── 2. One enabled connector on B ──────────────────────────────────────
  const sealed = sealSecret(CONNECTOR_SECRET);
  assert.ok(sealed !== CONNECTOR_SECRET && !sealed.includes(CONNECTOR_SECRET), "the stored secret is sealed");
  const [{ id: K }] = (await db.execute(sql`INSERT INTO connectors (user_id, name, url, mode, secret, phone_number_id, last_test_at, last_test_ok)
    VALUES (${ACC}, ${CONNECTOR_NAME}, ${BOT_HOOK}, 'voice', ${sealed}, ${PB_ID}, now(), true) RETURNING id`)) as unknown as Array<{ id: string }>;
  const setRow = (patch: ReturnType<typeof sql>) => db.execute(sql`UPDATE connectors SET ${patch} WHERE id = ${K}`);
  reset();
  const connB = await call(onB);
  assert.deepEqual(parse(connB).clientAgent, { url: BOT_HOOK, secret: CONNECTOR_SECRET, mode: "voice" }, "the connector's agent, secret opened");
  assert.equal(without(connB, "clientAgent"), without(zeroA, "clientAgent"), "the rest of the payload is the account's");
  assert.deepEqual(Object.keys(parse(connB)), Object.keys(parse(zeroA)), "same keys, same order (no new served field)");
  assert.deepEqual(events.filter((e) => e.event === "connector_route").map((e) => e.metadata), [
    { kind: "connector", connectorId: K, failed: false, accountAgentIgnored: false },
  ]);
  reset();
  const recA = await call(onA);
  assert.ok(!("clientAgent" in parse(recA)), "number A: no clientAgent, even with the account-level agent ON");
  assert.equal(recA, without(zeroA, "clientAgent"), "number A = today's payload minus clientAgent");
  assert.deepEqual(events.filter((e) => e.event === "connector_route").map((e) => e.metadata), [
    { kind: "reception", connectorId: null, failed: false, accountAgentIgnored: true },
  ]);
  const recWeb = await call(web);
  assert.ok(!("clientAgent" in parse(recWeb)), "web (no number) with rows: no clientAgent");
  assert.equal(alerts.length, 0, "no alert on the normal paths");
  console.log("ok: 2. connector on B: its agent (url / mode / opened secret), the rest = the account's; A and web: no clientAgent");

  // ── 3. The connector OFF ───────────────────────────────────────────────
  await setRow(sql`enabled = false`);
  const offB = await call(onB);
  assert.equal(offB, recA, "connector OFF on B = the reception payload, byte for byte");
  await setRow(sql`enabled = true`);
  console.log("ok: 3. connector OFF → no clientAgent on B (= reception, byte-identical)");

  // ── 4. The connector's voice ───────────────────────────────────────────
  const v = { ...DEFAULT_VOICE, voiceId: "cedar", patience: 2 };
  await setRow(sql`voice_config = ${JSON.stringify(v)}::jsonb`);
  const voiced = parse(await call(onB));
  assert.deepEqual(voiced.voiceConfig, servedConnectorVoice(v, "gpt-realtime-2"), "voiceConfig = the connector's voice");
  assert.equal(voiced.voice, "cedar", "legacy voice field from the connector's voice");
  assert.equal((voiced.voiceProfile as { turnSensitivity: number }).turnSensitivity, 2);
  assert.notEqual(parse(zeroA).voice, "cedar", "the account's voice differs (the test is meaningful)");
  assert.deepEqual(voiced.clientAgent, { url: BOT_HOOK, secret: CONNECTOR_SECRET, mode: "voice" });
  // On A the account's voice, untouched.
  assert.equal(await call(onA), recA, "A keeps the account's voice");
  await setRow(sql`voice_config = NULL`);
  assert.equal(await call(onB), connB, "voice_config NULL = the account's voice again");
  console.log("ok: 4. voice_config served when set (voiceConfig + legacy fields); NULL = the account's");

  // ── 5. Safety rules ────────────────────────────────────────────────────
  // A secret sealed with another key can't be opened → not served (reported).
  reset();
  const prevKey = process.env.SECRETS_KEY;
  process.env.SECRETS_KEY = KEY_2;
  process.env.SECRETS_KEY_ID = "mock2";
  const foreign = sealSecret(CONNECTOR_SECRET);
  process.env.SECRETS_KEY = prevKey;
  process.env.SECRETS_KEY_ID = "mock1";
  await setRow(sql`secret = ${foreign}`);
  assert.equal(await call(onB), recA, "unopenable secret → not served (= reception)");
  assert.deepEqual(unreadable, ["client_agent"], "reported once");
  // No secret → not served + the deduped alert.
  reset();
  await setRow(sql`secret = NULL`);
  assert.equal(await call(onB), recA, "no secret → not served (= reception)");
  assert.deepEqual(alerts.map((a) => [a.key, a.dedupMs]), [[connectorNoSecretAlertKey(ACC), 24 * 60 * 60 * 1000]]);
  assert.equal(connectorNoSecretAlertKey(ACC), `client_agent_no_secret:${ACC}`);
  assert.ok(events.some((e) => e.event === "client_agent_no_secret"));
  // An unsafe url → not served: refused by the static shape (an IP literal)
  // or by the full check at serve time (a name resolving to a private address).
  await setRow(sql`secret = ${sealed}, url = 'https://127.0.0.1/hook'`);
  assert.equal(await call(onB), recA, "IP-literal url → not served (= reception)");
  reset();
  await setRow(sql`url = 'https://internal.example.com/hook'`);
  assert.equal(await call(onB), recA, "url resolving to a private address → not served (= reception)");
  assert.ok(events.some((e) => e.event === "client_agent_unsafe"), "checkAgentUrl refused it at serve time");
  // A plain (pre-E1) secret is served as is.
  await setRow(sql`secret = ${CONNECTOR_SECRET}, url = ${BOT_HOOK}`);
  assert.equal(await call(onB), connB, "a plain secret serves the same payload");
  await setRow(sql`secret = ${sealed}`);
  assert.equal(await call(onB), connB);
  console.log("ok: 5. unopenable secret / no secret (+ alert) / unsafe url → not served");

  // ── 6. Fail-open: throw injection ──────────────────────────────────────
  const real = (await import("../../lib/connectors/route-load")).LIVE_CONNECTOR_ROUTE_DEPS;
  const injections: Array<[string, Partial<Effects>]> = [
    ["rows read rejects", { connectorDeps: { ...real, loadRows: async () => Promise.reject(new Error("mock db down")) } }],
    ["rows read throws synchronously", { connectorDeps: { ...real, loadRows: (() => { throw new Error("mock sync"); }) as never } }],
    ["number read rejects", { connectorDeps: { ...real, dialedPhoneRowId: async () => Promise.reject(new Error("mock db down")) } }],
    ["bad row (mode)", { connectorDeps: { ...real, loadRows: async (a) => (await real.loadRows(a)).map((r) => ({ ...r, mode: "boss" })) } }],
    ["bad row (voice_config)", { connectorDeps: { ...real, loadRows: async (a) => (await real.loadRows(a)).map((r) => ({ ...r, voiceConfig: { voiceId: "x" } })) } }],
  ];
  for (const [name, over] of injections) {
    reset();
    assert.equal(await call(onB, fx(over)), recA, `${name}: byte-identical to the reception payload`);
    assert.deepEqual(alerts.map((a) => [a.key, a.dedupMs]), [[connectorRouteFailedAlertKey(ACC), 24 * 60 * 60 * 1000]], `${name}: one alert`);
    assert.ok(events.some((e) => e.event === "connector_route" && e.metadata?.failed === true));
  }
  // An alert sink that throws (sync / async) and an event sink that throws: nothing changes.
  const failing: Partial<Effects> = { connectorDeps: { ...real, loadRows: async () => Promise.reject(new Error("mock db down")) } };
  for (const sink of [() => { throw new Error("sync sink"); }, async () => Promise.reject(new Error("async sink"))]) {
    assert.equal(await call(onB, fx({ ...failing, alertAdmins: sink as never })), recA, "a throwing alert sink changes nothing");
  }
  assert.equal(connectorRouteFailedAlertKey(ACC), `connector_route_failed:${ACC}`);
  console.log(`ok: 6. fail-open: ${injections.length} injections → the reception payload byte for byte + one daily alert`);

  // ── 7. Never served ────────────────────────────────────────────────────
  for (const t of [connB, recA, recWeb]) {
    assert.ok(!t.includes(CONNECTOR_NAME), "the connector's name is never served");
    assert.ok(!t.includes(K), "the connector's id is never served");
    assert.ok(!t.includes(PB_ID), "the number's row id is never served");
    assert.ok(!/lastTest|last_test|connectorId|phoneNumberId/.test(t), "no connector column served");
    assert.ok(!t.includes(sealed), "the sealed secret is never served");
  }
  console.log("ok: 7. never served: connector name / id / number id / test results / sealed value");

  // ── 8. A soft-deleted connector never routes ───────────────────────────
  // Worst case: deleted_at set but the number NOT cleared (the DELETE route
  // clears it too): the deleted_at filter alone keeps it off the call path.
  const [{ id: PA_ID }] = (await db.execute(sql`SELECT id FROM phone_numbers WHERE phone_number = ${PA}`)) as unknown as Array<{ id: string }>;
  await db.execute(sql`INSERT INTO connectors (user_id, name, url, mode, secret, phone_number_id, enabled)
    VALUES (${ACC}, 'Mock bot A', 'https://bot-a.example.com/hook', 'lead', ${sealed}, ${PA_ID}, false)`);
  await setRow(sql`deleted_at = now()`);
  reset();
  assert.equal(await call(onB), recA, "a deleted connector on B → reception (byte-identical)");
  assert.deepEqual(events.filter((e) => e.event === "connector_route").map((e) => e.metadata), [
    { kind: "reception", connectorId: null, failed: false, accountAgentIgnored: true },
  ], "routed as reception, never to the deleted id");
  await db.execute(sql`DELETE FROM connectors WHERE user_id = ${ACC} AND deleted_at IS NULL`);
  assert.equal(await call(onB), zeroB, "deleted rows only = zero live rows → legacy (the account-level agent), as before any row");
  console.log("ok: 8. a soft-deleted connector never routes (B → reception; deleted rows only → legacy)");

  await db.execute(sql`DELETE FROM users WHERE id = ${ACC}`);
  console.log("ALL CONNECTOR ROUTE DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
