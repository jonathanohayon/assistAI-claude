// Connectors B4 (create / edit / delete / test, behind CONNECTORS_WRITE)
// against a THROWAWAY Postgres, through the real route handlers:
//   1. switch unset → every write route 404 connectors_write_off, nothing
//      written (connectors / events / agent_configs / users md5), GET unchanged;
//   2. admin mode: an admin session 201 (via ?asUserId, source "admin"), a
//      tenant 404;
//   3. on: create (the secret ONCE, sealed at rest, enabled by default),
//      patch (omitted kept, rotate), delete (first while active 409, a
//      second 200 + numberKept, the number stays on the account);
//   4. the 4 gate cases on PATCH (voiceConfig.engine is admin-only);
//   5. limits: trial 1 → trial_limit; paid 2nd → orders_closed (PRODUCT_ORDERS
//      off); the hard 10 → max_reached;
//   6. number conflicts: another connector's number 409, another account's
//      number 404, a tamaravox number 409;
//   7. the legacy materialization: GET exposes legacyConversion; POST without
//      the acknowledgement 409; a refused write rolls the conversion back;
//      zero rows + legacy ON + POST on B → 2 rows (legacy on A, new on B),
//      the events record it; PATCH "legacy" converts too; tools_config untouched;
//   8. test → last_test_* written, the stored secret opened, no real URL.
// Plain `npm test` skips it. Run it with:  bash scripts/connectors-write-db.sh
// Only a 127.0.0.1/localhost URL; DATABASE_URL never read from the shell.
// Mock data only (example.com / example.test, +1555). No network: fetch and
// DNS are replaced (DNS answers a documentation-range-free public mock).

import assert from "node:assert/strict";
import dns from "node:dns";

const url = process.env.CONNECTORS_WRITE_DB_TEST_URL;
if (!url) {
  console.log("skip: connectors write DB part (no CONNECTORS_WRITE_DB_TEST_URL — see scripts/connectors-write-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /^(LIVEKIT|TWILIO|RESEND|WHATSAPP|GOOGLE)|OPENAI|REALTIME_API_KEY|EMAIL_FROM|CAMPAIGN_DISPATCH|CLIENT_AGENT|PRODUCT_ORDERS|^CONNECTORS_WRITE$|SECRETS_KEY/i.test(k))) {
  throw new Error("refusing to run with provider env or product flags set");
}
if (!(globalThis as { __connectorsWriteHooks?: boolean }).__connectorsWriteHooks) throw new Error("module hooks missing: run through scripts/connectors-write-db.sh");
process.env.DATABASE_URL = url;
// A MOCK sealing key (32 bytes of 0x07), this process only.
process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SECRETS_KEY_ID = "mocktest";

// Nothing leaves the process: fetch refused; DNS answers a fixed public
// address for *.example.com and fails everything else (recorded).
const network = { fetch: [] as string[], dns: [] as string[] };
globalThis.fetch = (async (input: string | URL | Request) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  network.fetch.push(u);
  throw new Error(`test: no network (${u})`);
}) as typeof fetch;
(dns.promises as { lookup: unknown }).lookup = async (hostname: string) => {
  network.dns.push(hostname);
  if (hostname === "private.example.com") return [{ address: "10.0.0.7", family: 4 }];
  if (hostname.endsWith(".example.com")) return [{ address: "8.8.4.4", family: 4 }];
  throw new Error("test: no DNS");
};

const g = globalThis as {
  __campgateSession?: { user: { id: string; email?: string } } | null;
  __voxNumbers?: string[];
  __agentTests?: Array<{ url: string; secret: string | null; language: string }>;
  __agentTestResult?: { ok: true; ms: number } | { ok: false; reason: string };
};
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ADMIN = id(0xad);
const PAID = id(0x41); // paid, no legacy: create / patch / delete / gate cases / hard 10
const LEG = id(0x42); // paid, legacy agent enabled, numbers A (oldest) + B
const TRIAL_LEG = id(0x43); // trialing, legacy agent enabled: PATCH "legacy", trial limit
const OTHER = id(0x44); // another account (its number)
const num = (n: number) => id(0x600 + n);
const e164 = (n: number) => `+1555000${(600 + n).toString().padStart(4, "0")}`;
const LEGACY_URL = "https://legacy.example.com/hook?token=mock-query";

type Json = Record<string, unknown> & { error?: string };

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { sealSecret, openSecret, isSealed } = await import("../../lib/crypto/secret-box");
  const collection = await import("../../app/api/dashboard/connectors/route");
  const item = await import("../../app/api/dashboard/connectors/[id]/route");
  const testRoute = await import("../../app/api/dashboard/connectors/[id]/test/route");
  const adminCatalogue = await import("../../app/api/admin/product-catalogue/route");

  const rows = async <T>(q: ReturnType<typeof sql>) => {
    const r = (await db.execute(q)) as unknown;
    return (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as T[];
  };
  const one = async <T>(q: ReturnType<typeof sql>) => (await rows<T>(q))[0];
  const n = async (q: ReturnType<typeof sql>) => Number((await rows<{ n: number }>(q))[0].n);
  const as = (uid: string | null) => {
    g.__campgateSession = uid ? { user: { id: uid, email: `${uid.slice(-4)}@example.test` } } : null;
  };
  const call = async (
    fn: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
    method: string,
    path: string,
    cid: string,
    body?: unknown,
  ) => {
    const req = new NextRequest(`http://localhost${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
    const res = await fn(req, { params: Promise.resolve({ id: cid }) });
    const text = await res.text();
    return { status: res.status, text, body: (text ? JSON.parse(text) : null) as Json };
  };
  const qs = (asUserId?: string) => (asUserId ? `?asUserId=${asUserId}` : "");
  const post = (body: unknown, asUserId?: string) =>
    call((req) => collection.POST(req), "POST", `/api/dashboard/connectors${qs(asUserId)}`, "", body);
  const patch = (cid: string, body: unknown, asUserId?: string) =>
    call(item.PATCH, "PATCH", `/api/dashboard/connectors/${cid}${qs(asUserId)}`, cid, body);
  const del = (cid: string, asUserId?: string) => call(item.DELETE, "DELETE", `/api/dashboard/connectors/${cid}${qs(asUserId)}`, cid);
  const test = (cid: string, body: unknown = {}, asUserId?: string) =>
    call(testRoute.POST, "POST", `/api/dashboard/connectors/${cid}/test${qs(asUserId)}`, cid, body);
  const get = async (asUserId?: string) => {
    const res = await collection.GET(new NextRequest(`http://localhost/api/dashboard/connectors${qs(asUserId)}`));
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) as Json & { connectors: Json[]; legacyConversion: Json } };
  };
  const md5 = async (table: string) =>
    (await one<{ m: string }>(sql.raw(`SELECT count(*) || ':' || md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) AS m FROM ${table} t`))).m;
  const snapshot = async () => [await md5("connectors"), await md5("events"), await md5("agent_configs"), await md5("users"), await md5("phone_numbers")].join("|");
  const rowsOf = (uid: string) =>
    rows<{ id: string; name: string; url: string; mode: string; secret: string | null; voice_config: unknown; enabled: boolean; phone_number_id: string | null; last_test_at: Date | null; last_test_ok: boolean | null }>(
      sql`SELECT id, name, url, mode, secret, voice_config, enabled, phone_number_id, last_test_at, last_test_ok FROM connectors WHERE user_id = ${uid} ORDER BY created_at, id`,
    );
  const eventsOf = (uid: string, ev: string) =>
    rows<{ source: string; metadata: Record<string, unknown> }>(sql`SELECT source, metadata FROM events WHERE user_id = ${uid} AND event = ${ev} ORDER BY created_at, id`);
  const setEnv = (k: "CONNECTORS_WRITE" | "PRODUCT_ORDERS", v: string | null) => {
    if (v === null) delete process.env[k];
    else process.env[k] = v;
  };

  // ── Seed (mock only) ───────────────────────────────────────────────────
  const paidUntil = new Date(Date.now() + 10 * 86400_000).toISOString();
  for (const [uid, role, status] of [
    [ADMIN, "admin", "active"],
    [PAID, "user", "active"],
    [LEG, "user", "active"],
    [TRIAL_LEG, "user", "trialing"],
    [OTHER, "user", "active"],
  ] as const) {
    await db.execute(sql`INSERT INTO users (id, email, password_hash, role, subscription_plan, subscription_status, subscription_period, paid_until, email_verified, locale)
      VALUES (${uid}, ${`${uid.slice(-4)}@connectors-write.example.test`}, 'x', ${role}, 'premium', ${status}, 'monthly', ${paidUntil}, true, 'fr')`);
  }
  const tools = (enabled: boolean, mode: string, secret: string | null) =>
    JSON.stringify({
      version: 1,
      booking: { enabled: true, defaultDurationMinutes: null, minNoticeMinutes: null },
      contacts: { enabled: true },
      transfer: { enabled: false, when: "always" },
      orders: { enabled: false, ask: "" },
      clientAgent: { enabled, url: LEGACY_URL, mode, secret },
    });
  const LEGACY_SEALED = sealSecret("mock-legacy-secret-0123456789");
  for (const [uid, t, lang] of [
    [ADMIN, tools(false, "lead", null), "fr"],
    [PAID, tools(false, "lead", null), "he"],
    [LEG, tools(true, "voice", LEGACY_SEALED), "fr"],
    [TRIAL_LEG, tools(true, "lead", "mock-plain-legacy-secret"), "fr"],
    [OTHER, tools(false, "lead", null), "fr"],
  ] as const) {
    await db.execute(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, tools_config, primary_language) VALUES (${uid}, 'mock', '', ${t}::jsonb, ${lang})`);
  }
  // PAID: numbers 1..12 (11 is the tamaravox one); LEG: 20 (A, oldest) + 21 (B); TRIAL_LEG: 30, 31; OTHER: 40; ADMIN: 50.
  const owners: Array<[number, string, string]> = [
    ...Array.from({ length: 12 }, (_, i) => [i + 1, PAID, `${i + 1} days`] as [number, string, string]),
    [20, LEG, "30 days"],
    [21, LEG, "1 day"],
    [30, TRIAL_LEG, "30 days"],
    [31, TRIAL_LEG, "1 day"],
    [40, OTHER, "1 day"],
    [50, ADMIN, "1 day"],
  ];
  for (const [k, uid, age] of owners) {
    await db.execute(sql`INSERT INTO phone_numbers (id, user_id, phone_number, label, created_at) VALUES (${num(k)}, ${uid}, ${e164(k)}, '', now() - ${age}::interval)`);
  }
  g.__voxNumbers = [e164(11)];
  const create = (k: number, extra: Record<string, unknown> = {}) => ({ name: `Bot ${k}`, url: `https://bot${k}.example.com/hook`, mode: "lead", phoneNumberId: num(k), ...extra });

  // ── 1. Switch unset → 404 everywhere, nothing written ──────────────────
  setEnv("CONNECTORS_WRITE", null);
  const before = await snapshot();
  for (const who of [ADMIN, PAID, LEG]) {
    as(who);
    for (const r of [
      await post(create(1)),
      await post(create(21, { acknowledgeLegacyConversion: true })),
      await patch("legacy", { name: "x", acknowledgeLegacyConversion: true }),
      await patch(id(0xc0), { name: "x" }),
      await del(id(0xc0)),
      await del("legacy"),
      await test(id(0xc0)),
      await test("legacy"),
    ]) {
      assert.deepEqual([r.status, r.body], [404, { error: "connectors_write_off" }], "switch off → 404 connectors_write_off");
    }
  }
  as(ADMIN);
  assert.deepEqual([(await post(create(1), PAID)).status], [404], "off refuses an admin via asUserId too");
  assert.equal(await snapshot(), before, "switch off: nothing written (connectors, events, agent_configs, users, phone_numbers)");
  assert.deepEqual(g.__agentTests ?? [], [], "switch off: no agent test ran");
  as(LEG);
  const legGet = await get();
  assert.equal(legGet.status, 200, "the GET is unchanged by the switch");
  assert.deepEqual(legGet.body.legacyConversion, { willConvert: true, numberE164: e164(20) }, "the GET exposes the pending conversion, on the main number");
  as(null);
  assert.equal((await post(create(1))).status, 401, "signed out → 401");
  as(PAID);
  assert.equal((await post(create(1), OTHER)).status, 403, "a tenant with a foreign asUserId → 403");
  console.log("ok: switch off (404 connectors_write_off on all 4 routes, nothing written, GET unchanged)");

  // ── 2. Admin mode ──────────────────────────────────────────────────────
  setEnv("CONNECTORS_WRITE", "admin");
  as(PAID);
  const tenantRefused = await post(create(1));
  assert.deepEqual([tenantRefused.status, tenantRefused.body], [404, { error: "connectors_write_off" }], "admin mode: a tenant is refused");
  assert.equal((await rowsOf(PAID)).length, 0);
  as(ADMIN);
  const c1 = await post(create(1), PAID);
  assert.equal(c1.status, 201, "admin mode: an admin creates (via asUserId)");
  const X = (c1.body.connector as Json).id as string;
  assert.deepEqual((await eventsOf(PAID, "connector_created")).map((e) => e.source), ["admin"], "admin write → source admin");
  console.log("ok: admin mode (admin 201, tenant 404)");

  // ── 3. On: create / secret once / patch / rotate ───────────────────────
  setEnv("CONNECTORS_WRITE", "on");
  const created = c1.body;
  assert.deepEqual(Object.keys(created).sort(), ["connector", "generatedSecret", "page"]);
  const secret1 = created.generatedSecret as string;
  assert.match(secret1, /^[A-Za-z0-9_-]{43}$/, "32 random bytes, base64url");
  assert.deepEqual(created.connector, {
    id: X,
    name: "Bot 1",
    numberE164: e164(1),
    mode: "lead",
    enabled: true,
    derived: false,
    state: "online",
    lastCallAt: null,
    lastTestAt: null,
    lastTestOk: null,
    secretSet: true,
    deletable: false,
  }, "the created connector: enabled by default, the first is not deletable while active");
  const [r1] = await rowsOf(PAID);
  assert.ok(isSealed(r1.secret) && r1.secret !== secret1, "stored sealed");
  assert.deepEqual(openSecret(r1.secret!), { ok: true, value: secret1 }, "the sealed value opens to the generated secret");
  assert.deepEqual([r1.url, r1.voice_config, r1.phone_number_id], ["https://bot1.example.com/hook", null, num(1)]);
  as(PAID);
  const g1 = await get();
  assert.ok(!g1.text.includes(secret1) && !g1.text.includes('"secret"'), "the GET never carries the secret");
  assert.equal((g1.body.connectors[0] as Json).secretSet, true);
  const p0 = await patch(X, { name: "Renamed" });
  assert.equal(p0.status, 200);
  assert.ok(!("generatedSecret" in p0.body) && !p0.text.includes(secret1), "a PATCH without rotate returns no secret");
  const [r1b] = await rowsOf(PAID);
  assert.deepEqual([r1b.name, r1b.url, r1b.mode, r1b.enabled, r1b.secret, r1b.phone_number_id], ["Renamed", r1.url, "lead", true, r1.secret, num(1)], "omitted fields kept");
  const rot = await patch(X, { rotateSecret: true });
  const secret2 = rot.body.generatedSecret as string;
  assert.ok(rot.status === 200 && typeof secret2 === "string" && secret2 !== secret1, "rotate → a new secret, once");
  assert.deepEqual(openSecret((await rowsOf(PAID))[0].secret!), { ok: true, value: secret2 });
  assert.equal((await rowsOf(PAID))[0].name, "Renamed", "rotate keeps the other fields");
  const all = (await rows<{ t: string }>(sql`SELECT coalesce(string_agg(message || coalesce(metadata::text, ''), ' '), '') AS t FROM events`))[0].t;
  assert.ok(!all.includes(secret1) && !all.includes(secret2) && !all.includes("bot1.example.com/hook") && !all.includes("mock-query"), "events carry no secret, url path or query");
  assert.deepEqual((await eventsOf(PAID, "connector_updated")).map((e) => (e.metadata as { fields: string[] }).fields), [["name"], ["secretRotated"]], "updated events name the fields only");
  const pBad = await patch(X, { phoneNumberId: num(2) });
  assert.deepEqual([pBad.status, pBad.body.error], [400, "number_not_editable"], "the number can't be changed in B4");
  const pUnsafe = await patch(X, { url: "https://private.example.com/hook" });
  assert.deepEqual([pUnsafe.status, pUnsafe.body.error], [400, "unsafe_url"], "the url check (private DNS answer)");
  const pHttp = await patch(X, { url: "http://bot1.example.com/hook" });
  assert.deepEqual([pHttp.status, pHttp.body.error], [400, "unsafe_url"], "the url check (not https)");
  assert.equal((await rowsOf(PAID))[0].url, "https://bot1.example.com/hook", "a refused url wrote nothing");
  assert.equal((await patch(id(0xbad), { name: "x" })).status, 404, "unknown id → 404");
  assert.equal((await patch("not-a-uuid", { name: "x" })).status, 404, "a non-uuid id → 404");
  assert.equal((await patch("legacy", { name: "x", acknowledgeLegacyConversion: true })).status, 404, "no legacy agent → PATCH legacy 404");
  const pDis = await patch(X, { enabled: false, mode: "voice" });
  assert.equal(pDis.status, 200);
  assert.deepEqual([(pDis.body.connector as Json).state, (pDis.body.connector as Json).mode], ["off", "voice"]);
  await patch(X, { enabled: true, mode: "lead" });
  console.log("ok: create (secret once, sealed, defaults), patch (omitted kept, rotate, number not editable, url check)");

  // ── 4. The 4 gate cases on PATCH (voiceConfig.engine is admin-only) ────
  as(PAID);
  const voiceBytes = async () => (await one<{ v: string | null }>(sql`SELECT voice_config::text AS v FROM connectors WHERE id = ${X}`)).v;
  const v0 = await voiceBytes();
  const t1 = await patch(X, { voiceConfig: { engine: "openai" } });
  assert.deepEqual([t1.status, t1.body.error], [403, "admin_only"], "gate 1: a tenant changing the engine → 403");
  assert.equal(await voiceBytes(), v0, "gate 1: nothing written");
  as(ADMIN);
  const t2 = await patch(X, { voiceConfig: { engine: "openai", patience: 2 } }, PAID);
  assert.equal(t2.status, 200, "gate 2: an admin sets the engine");
  assert.equal(JSON.parse((await voiceBytes())!).engine, "openai");
  as(PAID);
  const t3 = await patch(X, { voiceConfig: { engine: "openai", patience: 4 } });
  assert.equal(t3.status, 200, "gate 3: a tenant re-sending the admin value with another field → 200");
  assert.deepEqual([JSON.parse((await voiceBytes())!).engine, JSON.parse((await voiceBytes())!).patience], ["openai", 4]);
  const v3 = await voiceBytes();
  const t4 = await patch(X, { name: "Renamed again" });
  assert.equal(t4.status, 200);
  assert.equal(await voiceBytes(), v3, "gate 4: voiceConfig omitted → the stored value kept, byte for byte");
  const t5 = await patch(X, { voiceConfig: null });
  assert.equal(t5.status, 200);
  assert.equal(await voiceBytes(), null, "voiceConfig: null → back to the account voice");
  console.log("ok: the 4 gate cases on PATCH (tenant 403, admin 200, kept value re-sent 200, omitted kept)");

  // ── 5. Limits ──────────────────────────────────────────────────────────
  as(PAID);
  setEnv("PRODUCT_ORDERS", null);
  const oc = await post(create(2));
  assert.deepEqual([oc.status, oc.body], [409, { error: "orders_closed" }], "paid: the 2nd → orders_closed while PRODUCT_ORDERS is off");
  // The hard 10: paid limit 10 in the catalogue, orders on.
  as(ADMIN);
  const cat = await adminCatalogue.PUT(
    new NextRequest("http://localhost/api/admin/product-catalogue", { method: "PUT", body: JSON.stringify({ connectorLimits: { paid: 10 } }), headers: { "content-type": "application/json" } }),
  );
  assert.equal(cat.status, 200);
  setEnv("PRODUCT_ORDERS", "on");
  as(PAID);
  for (const k of [2, 3, 4, 5, 6, 7, 8, 9, 10]) assert.equal((await post(create(k))).status, 201, `connector ${k} of 10`);
  assert.equal((await rowsOf(PAID)).length, 10);
  const mx = await post(create(12));
  assert.deepEqual([mx.status, mx.body], [409, { error: "max_reached" }], "the 11th → max_reached (hard 10)");
  console.log("ok: limits (orders_closed, hard 10 → max_reached)");

  // ── 6. Number conflicts ────────────────────────────────────────────────
  // Free one slot (delete #10, not the first).
  const ids = (await rowsOf(PAID)).map((r) => r.id);
  assert.equal((await del(ids[9])).status, 200);
  const before6 = await md5("connectors");
  const inUse = await post(create(2));
  assert.deepEqual([inUse.status, inUse.body], [409, { error: "number_in_use" }], "another connector's number → 409");
  const foreign = await post(create(40));
  assert.deepEqual([foreign.status, foreign.body], [404, { error: "number_not_found" }], "another account's number → 404");
  const vox = await post(create(11));
  assert.deepEqual([vox.status, vox.body], [409, { error: "tamaravox_number" }], "a tamaravox number → 409");
  const unsafe = await post(create(12, { url: "https://private.example.com/hook" }));
  assert.deepEqual([unsafe.status, unsafe.body.error], [400, "unsafe_url"]);
  const badBody = await post({ ...create(12), secret: "mine" });
  assert.deepEqual([badBody.status, badBody.body], [400, { error: "invalid_body", fields: ["secret"] }], "a client secret is refused");
  assert.equal(await md5("connectors"), before6, "conflicts wrote nothing");
  console.log("ok: number conflicts (connector 409, foreign 404, tamaravox 409)");

  // ── Delete ─────────────────────────────────────────────────────────────
  const first = await del(ids[0]);
  assert.deepEqual([first.status, first.body], [409, { error: "first_connector_active" }], "the first while the product is active → 409");
  const second = await del(ids[1]);
  assert.equal(second.status, 200);
  assert.deepEqual([second.body.deletedId, second.body.numberKept], [ids[1], true], "a second → 200 + numberKept");
  assert.equal(await n(sql`SELECT count(*)::int AS n FROM phone_numbers WHERE id = ${num(2)} AND user_id = ${PAID}`), 1, "the number stays on the account");
  assert.equal((await post(create(2))).status, 201, "the kept number can host a new connector");
  assert.equal((await del("legacy")).status, 409, "legacy → 409 legacy_not_deletable");
  assert.equal((await del(id(0xbad))).status, 404);
  assert.deepEqual((await eventsOf(PAID, "connector_deleted")).length, 2);
  console.log("ok: delete (first active 409, second 200 + numberKept, number kept)");

  // ── 7. The legacy materialization ──────────────────────────────────────
  as(LEG);
  const legTools = await md5("agent_configs");
  setEnv("PRODUCT_ORDERS", null);
  const noAck = await post(create(21));
  assert.deepEqual([noAck.status, noAck.body], [409, { error: "legacy_conversion_unacknowledged", legacyConversion: { willConvert: true, numberE164: e164(20) } }], "a conversion needs the acknowledgement");
  const rolledBack = await post(create(21, { acknowledgeLegacyConversion: true }));
  assert.deepEqual([rolledBack.status, rolledBack.body], [409, { error: "orders_closed" }], "paid, the legacy counts as 1: the new one is the 2nd");
  assert.equal((await rowsOf(LEG)).length, 0, "a refused write rolls the conversion back");
  setEnv("PRODUCT_ORDERS", "on");
  const conv = await post(create(21, { acknowledgeLegacyConversion: true }));
  assert.equal(conv.status, 201, "zero rows + legacy ON + POST on B → created");
  const legRows = await rowsOf(LEG);
  assert.equal(legRows.length, 2, "2 rows: the legacy and the new one");
  assert.deepEqual(
    [legRows[0].name, legRows[0].url, legRows[0].mode, legRows[0].secret, legRows[0].voice_config, legRows[0].enabled, legRows[0].phone_number_id],
    ["", LEGACY_URL, "voice", LEGACY_SEALED, null, true, num(20)],
    "the legacy row: its url / mode / secret (sealed, copied as is), account voice, on A",
  );
  assert.deepEqual([legRows[1].name, legRows[1].phone_number_id], ["Bot 21", num(21)], "the new one on B");
  assert.equal(conv.body.legacyConvertedId, legRows[0].id);
  assert.equal(await md5("agent_configs"), legTools, "tools_config.clientAgent is not modified");
  assert.deepEqual((await eventsOf(LEG, "connector_legacy_converted")).map((e) => e.metadata), [{ connectorId: legRows[0].id, phoneNumberId: num(20), trigger: "create" }]);
  assert.deepEqual((await eventsOf(LEG, "connector_created")).map((e) => e.metadata.connectorId), [legRows[1].id]);
  const legAfter = await get();
  assert.deepEqual(legAfter.body.legacyConversion, { willConvert: false, numberE164: null }, "once converted, no conversion pending");
  assert.deepEqual(legAfter.body.connectors.map((c) => [c.derived, c.numberE164, c.deletable]), [[false, e164(20), false], [false, e164(21), true]]);
  assert.ok(!legAfter.text.includes(LEGACY_SEALED));
  assert.equal((await post(create(20))).body.error, "number_in_use", "the legacy's number is now held");
  assert.equal((await patch("legacy", { name: "x", acknowledgeLegacyConversion: true })).status, 404, "rows exist → no legacy card to patch");
  // PATCH "legacy" (trial account).
  as(TRIAL_LEG);
  const tl0 = await patch("legacy", { name: "My agent" });
  assert.deepEqual([tl0.status, tl0.body.error], [409, "legacy_conversion_unacknowledged"]);
  const tl1 = await patch("legacy", { name: "My agent", acknowledgeLegacyConversion: true });
  assert.equal(tl1.status, 200, "PATCH legacy converts, then applies the patch");
  const tlRows = await rowsOf(TRIAL_LEG);
  assert.deepEqual(tlRows.map((r) => [r.name, r.url, r.mode, r.secret, r.phone_number_id]), [["My agent", LEGACY_URL, "lead", "mock-plain-legacy-secret", num(30)]], "a plain stored secret is copied as is too");
  assert.equal((tl1.body.connector as Json).id, tlRows[0].id);
  assert.deepEqual((await eventsOf(TRIAL_LEG, "connector_legacy_converted")).map((e) => e.metadata.trigger), ["patch_legacy"]);
  const tl2 = await post(create(31));
  assert.deepEqual([tl2.status, tl2.body], [409, { error: "trial_limit" }], "trial: the 2nd → trial_limit");
  console.log("ok: legacy materialization (exposed, acknowledged, rolled back on refusal, 2 rows, events, PATCH legacy)");

  // ── 8. Test ────────────────────────────────────────────────────────────
  as(PAID);
  g.__agentTests = [];
  const tOk = await test(X);
  assert.equal(tOk.status, 200);
  assert.deepEqual([tOk.body.ok, tOk.body.ms], [true, 42]);
  assert.deepEqual(g.__agentTests, [{ url: "https://bot1.example.com/hook", secret: secret2, language: "he" }], "the connector's url, its secret opened, the account language");
  const [rx] = (await rowsOf(PAID)).filter((r) => r.id === X);
  assert.ok(rx.last_test_at instanceof Date || typeof rx.last_test_at === "string");
  assert.equal(rx.last_test_ok, true, "last_test_ok written");
  assert.equal(new Date(rx.last_test_at as Date).toISOString(), tOk.body.lastTestAt);
  g.__agentTestResult = { ok: false, reason: "timeout" };
  const tKo = await test(X, { language: "en" });
  assert.deepEqual([tKo.body.ok, tKo.body.reason], [false, "timeout"]);
  assert.equal((await rowsOf(PAID)).find((r) => r.id === X)!.last_test_ok, false, "a failed test writes false");
  assert.equal(g.__agentTests!.at(-1)!.language, "en");
  assert.ok(!tOk.text.includes(secret2));
  assert.equal((await test(id(0xbad))).status, 404);
  as(OTHER);
  assert.equal((await test(X)).status, 404, "another account's connector → 404");
  assert.equal((await del(X)).status, 404);
  assert.equal((await patch(X, { name: "hijack" })).status, 404);
  console.log("ok: test (last_test_* written, the stored secret opened, mocked agent)");

  assert.deepEqual(network.fetch, [], "no fetch left the process");
  assert.ok(network.dns.every((h) => h.endsWith(".example.com")), "DNS only for mock example.com names");
  console.log("ALL CONNECTORS WRITE DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
