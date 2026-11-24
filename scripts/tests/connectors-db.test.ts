// Connectors B1 (migration 0062) against a THROWAWAY Postgres, through the
// real code:
//   1. the table's constraints: mode CHECK, one number per connector
//      (UNIQUE phone_number_id), user delete cascades, number delete and
//      connector delete SET NULL;
//   2. GET /api/dashboard/connectors: signed out 401, a non-admin with a
//      foreign ?asUserId 403, the tenant 200, an admin via ?asUserId 200
//      (the TARGET's page); the ConnectorsPageView shape; no secret value or
//      secret key anywhere in the body; nothing written by a GET;
//   3. the legacy card: zero rows + enabled legacy → one derived card on the
//      OLDEST number; zero rows + off → none; >= 1 row → rows only;
//   4. lastCallAt from calls.connector_id; limits from the stored catalogue
//      row (trial 1 / paid 5 defaults, a stored paid 7), orders_closed;
//   5. the admin catalogue PUT: omitted connectorLimits keeps the stored
//      value, a valid one is written, > 10 is refused with nothing written.
//   5b. C1b: the extra-connector price (absent = identical row bytes and no
//      response key, partial written, omitted kept, refused), canAdd.price
//      (fr → EUR, he → ILS, trial → null), deletable per product state.
// Plain `npm test` skips it. Run it with:  bash scripts/connectors-db.sh
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read from
// the shell. Mock data only (example.test, +1555). Dynamic imports only after
// the env checks.

import assert from "node:assert/strict";

import type { ConnectorsPageView } from "../../lib/connectors/types";

const url = process.env.CONNECTORS_DB_TEST_URL;
if (!url) {
  console.log("skip: connectors DB part (no CONNECTORS_DB_TEST_URL — see scripts/connectors-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /^(LIVEKIT|TWILIO|RESEND|WHATSAPP|GOOGLE)|OPENAI|REALTIME_API_KEY|EMAIL_FROM|CAMPAIGN_DISPATCH|CLIENT_AGENT|PRODUCT_ORDERS/i.test(k))) {
  throw new Error("refusing to run with provider env or product flags set");
}
if (!(globalThis as { __campgateHooks?: boolean }).__campgateHooks) throw new Error("module hooks missing: run through scripts/connectors-db.sh");
process.env.DATABASE_URL = url;

const g = globalThis as { __campgateSession?: { user: { id: string; email?: string } } | null };
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ADMIN = id(0xad);
const TENANT = id(0x31); // paid, legacy agent enabled, no connector row
const TRIAL = id(0x32); // trialing, legacy agent off
const ROWS = id(0x33); // paid, two connector rows + a legacy setting (ignored)
const GONE = id(0x34); // deleted at the end (cascade)
const SECRET = "mock-connector-secret-0123456789";
const LEGACY_SECRET = "mock-legacy-secret-0123456789";

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const route = await import("../../app/api/dashboard/connectors/route");
  const adminCatalogue = await import("../../app/api/admin/product-catalogue/route");
  const { getConnectorLimits } = await import("../../lib/products");

  const rows = async <T>(q: ReturnType<typeof sql>) => {
    const r = (await db.execute(q)) as unknown;
    return (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as T[];
  };
  const count = async (q: ReturnType<typeof sql>) => Number((await rows<{ n: number }>(q))[0].n);
  const as = (uid: string | null) => {
    g.__campgateSession = uid ? { user: { id: uid, email: `${uid.slice(-4)}@example.test` } } : null;
  };
  const get = async (qs = "") => {
    const res = await route.GET(new NextRequest(`http://localhost/api/dashboard/connectors${qs}`));
    const text = await res.text();
    return { status: res.status, text, body: text ? (JSON.parse(text) as ConnectorsPageView) : null };
  };
  // The driver error's text (drizzle wraps the pg error in `cause`).
  const errText = (e: unknown): string => {
    if (e instanceof Error) {
      const cause = e.cause instanceof Error ? e.cause.message : "";
      return `${cause} ${e.message}`;
    }
    return String(e);
  };
  const tableMd5 = async () =>
    (await rows<{ m: string }>(sql`SELECT md5(coalesce(string_agg(c::text, E'\n' ORDER BY c.id), '')) AS m FROM connectors c`))[0].m;

  const paidUntil = new Date(Date.now() + 10 * 86400_000).toISOString();
  const seeds: Array<[string, string, string, string]> = [
    [ADMIN, "admin", "active", "fr"],
    [TENANT, "user", "active", "fr"],
    [TRIAL, "user", "trialing", "fr"],
    [ROWS, "user", "active", "he"],
    [GONE, "user", "active", "fr"],
  ];
  for (const [uid, role, status, locale] of seeds) {
    await db.execute(sql`INSERT INTO users (id, email, password_hash, role, subscription_plan, subscription_status, subscription_period, paid_until, email_verified, locale)
      VALUES (${uid}, ${`${uid.slice(-4)}@connectors.example.test`}, 'x', ${role}, 'premium', ${status}, 'monthly', ${paidUntil}, true, ${locale})`);
  }
  const tools = (enabled: boolean, mode: string, secret: string | null) =>
    JSON.stringify({
      version: 1,
      booking: { enabled: true, defaultDurationMinutes: null, minNoticeMinutes: null },
      contacts: { enabled: true },
      transfer: { enabled: false, when: "always" },
      orders: { enabled: false, ask: "" },
      clientAgent: { enabled, url: "https://agent.example.com/hook", mode, secret },
    });
  for (const [uid, t] of [
    [TENANT, tools(true, "voice", LEGACY_SECRET)],
    [TRIAL, tools(false, "lead", null)],
    [ROWS, tools(true, "lead", LEGACY_SECRET)],
  ] as const) {
    await db.execute(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, tools_config) VALUES (${uid}, 'mock', '', ${t}::jsonb)`);
  }
  // TENANT: two numbers, the OLDEST is the main one (inserted second, older created_at).
  await db.execute(sql`INSERT INTO phone_numbers (id, user_id, phone_number, label, created_at) VALUES
    (${id(0x501)}, ${TENANT}, '+15550000502', 'Second line', now()),
    (${id(0x502)}, ${TENANT}, '+15550000501', 'Main line', now() - interval '30 days'),
    (${id(0x503)}, ${ROWS}, '+15550000503', 'Bot A line', now()),
    (${id(0x504)}, ${ROWS}, '+15550000504', '', now()),
    (${id(0x505)}, ${GONE}, '+15550000505', '', now())`);

  // ── 1. Constraints ──────────────────────────────────────────────────────
  const C1 = id(0xc01);
  const C2 = id(0xc02);
  await db.execute(sql`INSERT INTO connectors (id, user_id, name, url, mode, secret, enabled, phone_number_id, last_test_at, last_test_ok, created_at)
    VALUES (${C1}, ${ROWS}, 'Bot A', 'https://a.example.com/hook', 'lead', ${SECRET}, true, ${id(0x503)}, '2026-11-20T10:00:00Z', true, now() - interval '2 days'),
           (${C2}, ${ROWS}, 'Bot B', '', 'voice', NULL, false, ${id(0x504)}, NULL, NULL, now() - interval '1 day')`);
  await assert.rejects(
    db.execute(sql`INSERT INTO connectors (user_id, name, mode) VALUES (${ROWS}, 'bad', 'chat')`),
    (e: unknown) => /connectors_mode_check/.test(errText(e)),
    "mode CHECK",
  );
  await assert.rejects(
    db.execute(sql`INSERT INTO connectors (user_id, name, mode, phone_number_id) VALUES (${ROWS}, 'dup', 'lead', ${id(0x503)})`),
    (e: unknown) => /connectors_phone_number_id_unique/.test(errText(e)),
    "one number per connector",
  );
  assert.equal(await count(sql`SELECT count(*)::int AS n FROM connectors`), 2);
  const defaults = (await rows<{ url: string; enabled: boolean; secret: string | null }>(sql`
    WITH ins AS (INSERT INTO connectors (user_id, name, mode) VALUES (${GONE}, 'Defaults', 'voice') RETURNING url, enabled, secret) SELECT * FROM ins`))[0];
  assert.deepEqual(defaults, { url: "", enabled: true, secret: null }, "column defaults");
  console.log("ok: constraints (mode CHECK, unique number, defaults)");

  // ── 2. GET gate cases + shape + no secret ──────────────────────────────
  const before = await tableMd5();
  as(null);
  assert.equal((await get()).status, 401, "signed out → 401");
  as(TENANT);
  assert.equal((await get(`?asUserId=${ROWS}`)).status, 403, "a non-admin with a foreign asUserId → 403");
  const t = await get();
  assert.equal(t.status, 200, "tenant → 200");
  assert.deepEqual(Object.keys(t.body!).sort(), ["canAdd", "connectors", "limits"]);

  // ── 3. Legacy card ─────────────────────────────────────────────────────
  assert.deepEqual(t.body!.connectors, [
    {
      id: "legacy",
      name: "",
      numberE164: "+15550000501",
      numberLabel: "Main line",
      mode: "voice",
      enabled: true,
      derived: true,
      state: "online",
      lastCallAt: null,
      lastTestAt: null,
      lastTestOk: null,
      secretSet: true,
      deletable: false,
    },
  ], "zero rows + enabled legacy → one derived card on the oldest number (never deletable)");
  assert.deepEqual(t.body!.limits, { max: 5, used: 1, inTrial: false });
  assert.deepEqual(t.body!.canAdd, { ok: false, reason: "orders_closed", price: { monthly: 19, currency: "EUR" } }, "paid, one used (the legacy card), PRODUCT_ORDERS off, fr → 19 EUR");
  as(TRIAL);
  const tr = await get();
  assert.deepEqual(tr.body, { connectors: [], limits: { max: 1, used: 0, inTrial: true }, canAdd: { ok: true, price: null } }, "zero rows + off → none; trial → no price");

  // Admin via asUserId: the target's rows (the legacy setting is ignored when rows exist).
  as(ADMIN);
  const a = await get(`?asUserId=${ROWS}`);
  assert.equal(a.status, 200, "admin via asUserId → 200");
  assert.deepEqual(a.body!.connectors.map((c) => [c.id, c.derived, c.state, c.numberE164, c.secretSet, c.deletable]), [
    [C1, false, "online", "+15550000503", true, false],
    [C2, false, "off", "+15550000504", false, true],
  ], ">= 1 row → rows only, oldest first; the oldest is not deletable while the product is active");
  assert.deepEqual(a.body!.canAdd, { ok: false, reason: "orders_closed", price: { monthly: 79, currency: "ILS" } }, "he account → 79 ILS");
  assert.equal(a.body!.connectors[0].numberLabel, "Bot A line");
  assert.ok(!("numberLabel" in a.body!.connectors[1]), "empty label omitted");
  assert.equal(a.body!.connectors[0].lastTestAt, "2026-11-20T10:00:00.000Z");
  assert.equal(a.body!.connectors[0].lastTestOk, true);
  assert.equal(a.body!.connectors[0].lastCallAt, null, "no call with a connector yet");
  for (const r of [t, tr, a]) {
    assert.ok(!r.text.includes(SECRET) && !r.text.includes(LEGACY_SECRET), "no secret value in the body");
    assert.ok(!/"secret"|"url"|"voiceConfig"|"phoneNumberId"|"locale"|"products"/.test(r.text), "no secret / url / internal key in the body");
  }
  assert.equal(await tableMd5(), before, "GET wrote nothing");
  console.log("ok: GET gate cases (401 / 403 / tenant / admin), shape, legacy card, no secret");

  // ── 4. lastCallAt + limits from the stored catalogue ───────────────────
  await db.execute(sql`INSERT INTO calls (user_id, from_number, to_number, duration_seconds, connector_id, created_at) VALUES
    (${ROWS}, '+15550000901', '+15550000503', 30, ${C1}, '2026-11-21T09:00:00Z'),
    (${ROWS}, '+15550000901', '+15550000503', 30, ${C1}, '2026-11-22T09:00:00Z'),
    (${ROWS}, '+15550000901', '+15550000504', 30, NULL, '2026-11-23T09:00:00Z'),
    (${TENANT}, '+15550000901', '+15550000503', 30, ${C1}, '2026-11-24T09:00:00Z')`);
  const a2 = await get(`?asUserId=${ROWS}`);
  assert.equal(a2.body!.connectors[0].lastCallAt, "2026-11-22T09:00:00.000Z", "latest call of the connector, own account only");
  assert.equal(a2.body!.connectors[1].lastCallAt, null);
  assert.deepEqual(a2.body!.limits, { max: 5, used: 2, inTrial: false });

  // ── 5. Admin catalogue PUT: the gate cases ─────────────────────────────
  const put = async (body: unknown) => {
    const res = await adminCatalogue.PUT(
      new NextRequest("http://localhost/api/admin/product-catalogue", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const stored = async () => (await rows<{ value: string }>(sql`SELECT value FROM app_settings WHERE key = 'product_catalogue_v1'`))[0]?.value ?? null;
  as(TENANT);
  assert.equal((await put({ connectorLimits: { paid: 7 } })).status, 403, "a tenant cannot write the catalogue");
  as(ADMIN);
  assert.deepEqual(await getConnectorLimits(), { trial: 1, paid: 5 }, "no row → defaults");
  const g0 = (await (await adminCatalogue.GET()).json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(g0), ["catalogue", "engineOverrides", "engineOptions"], "nothing stored → the pre-B1 keys");
  const p0 = await put({ catalogue: { connect: { EUR: { monthly: 49 } } } });
  assert.deepEqual(Object.keys(p0.body), ["ok", "catalogue", "engineOverrides"], "PUT without limits → the pre-B1 keys");
  const p1 = await put({ connectorLimits: { paid: 7 } });
  assert.equal(p1.status, 200);
  assert.deepEqual(p1.body.connectorLimits, { trial: 1, paid: 7 });
  assert.deepEqual(JSON.parse((await stored())!).connectorLimits, { trial: 1, paid: 7 }, "written");
  const p2 = await put({ catalogue: { connect: { EUR: { monthly: 49 } } } });
  assert.equal(p2.status, 200);
  assert.deepEqual(p2.body.connectorLimits, { trial: 1, paid: 7 }, "omitted → unchanged");
  const s2 = await stored();
  const p3 = await put({ connectorLimits: { paid: 11 } });
  assert.deepEqual([p3.status, p3.body], [400, { error: "invalid_catalogue", fields: ["connectorLimits.paid"] }], "> 10 refused");
  assert.equal(await stored(), s2, "the refusal wrote nothing");
  const p4 = await put({ catalogue: { connect: { EUR: { monthly: 59 } } } });
  assert.equal(p4.status, 200);
  assert.deepEqual(JSON.parse((await stored())!).connectorLimits, { trial: 1, paid: 7 }, "a price-only write keeps the limits");
  await put({ catalogue: { connect: { EUR: { monthly: 49 } } } });
  as(ADMIN);
  const a3 = await get(`?asUserId=${ROWS}`);
  assert.deepEqual(a3.body!.limits, { max: 7, used: 2, inTrial: false }, "the page reads the stored limits");
  const ga = await adminCatalogue.GET();
  assert.deepEqual(((await ga.json()) as Record<string, unknown>).connectorLimits, { trial: 1, paid: 7 }, "admin GET shows the limits");
  console.log("ok: lastCallAt, stored limits, admin PUT gate cases (omitted kept, valid written, > 10 refused)");

  // ── 5b. C1b: the extra-connector price (admin PUT gate cases) ──────────
  const keysOf = (o: unknown) => Object.keys(o as Record<string, unknown>);
  assert.ok(!("connectorExtraMonthly" in JSON.parse((await stored())!)), "no price stored yet: the row has no key");
  assert.deepEqual(keysOf(await (await adminCatalogue.GET()).json()), ["catalogue", "engineOverrides", "engineOptions", "connectorLimits"], "GET: no price key until stored");
  as(TENANT);
  assert.equal((await put({ connectorExtraMonthly: { EUR: 25 } })).status, 403, "a tenant cannot write the price");
  as(ADMIN);
  const sNoPrice = await stored();
  const q1 = await put({ catalogue: { connect: { EUR: { monthly: 49 } } } });
  assert.deepEqual([q1.status, keysOf(q1.body)], [200, ["ok", "catalogue", "engineOverrides", "connectorLimits"]], "omitted, not stored → no key");
  assert.equal(await stored(), sNoPrice, "omitted, not stored → identical bytes");
  const q2 = await put({ connectorExtraMonthly: { EUR: 25 } });
  assert.equal(q2.status, 200);
  assert.deepEqual(q2.body.connectorExtraMonthly, { EUR: 25, ILS: 79 }, "partial: ILS keeps the default");
  assert.deepEqual(JSON.parse((await stored())!).connectorExtraMonthly, { EUR: 25, ILS: 79 }, "written");
  assert.deepEqual(JSON.parse((await stored())!).connectorLimits, { trial: 1, paid: 7 }, "the limits are kept");
  const q3 = await put({ connectorLimits: { paid: 7 } });
  assert.deepEqual(q3.body.connectorExtraMonthly, { EUR: 25, ILS: 79 }, "omitted → unchanged");
  const sPrice = await stored();
  const q4 = await put({ connectorExtraMonthly: { ILS: -1, USD: 3 } });
  assert.deepEqual([q4.status, q4.body], [400, { error: "invalid_catalogue", fields: ["connectorExtraMonthly.ILS", "connectorExtraMonthly.USD"] }], "bad price refused");
  assert.equal(await stored(), sPrice, "the refusal wrote nothing");
  assert.deepEqual(((await (await adminCatalogue.GET()).json()) as Record<string, unknown>).connectorExtraMonthly, { EUR: 25, ILS: 79 }, "admin GET shows the price");
  as(TENANT);
  assert.deepEqual((await get()).body!.canAdd.price, { monthly: 25, currency: "EUR" }, "the page reads the stored price");
  as(ADMIN);
  assert.deepEqual((await get(`?asUserId=${ROWS}`)).body!.canAdd.price, { monthly: 79, currency: "ILS" });

  // ── 5c. C1b: deletable follows the product state ───────────────────────
  await db.execute(sql`UPDATE users SET subscription_status = 'expired' WHERE id = ${ROWS}`);
  assert.deepEqual((await get(`?asUserId=${ROWS}`)).body!.connectors.map((c) => c.deletable), [true, true], "product inactive → the first is deletable too");
  await db.execute(sql`UPDATE users SET subscription_status = 'active', products = ${JSON.stringify({ base: "reception", addons: [] })}::jsonb WHERE id = ${ROWS}`);
  assert.deepEqual((await get(`?asUserId=${ROWS}`)).body!.connectors.map((c) => c.deletable), [true, true], "paid without connect → not active");
  await db.execute(sql`UPDATE users SET products = ${JSON.stringify({ base: "reception", addons: ["connect"] })}::jsonb WHERE id = ${ROWS}`);
  assert.deepEqual((await get(`?asUserId=${ROWS}`)).body!.connectors.map((c) => c.deletable), [false, true], "connect add-on → the first is kept");
  await db.execute(sql`UPDATE users SET products = NULL WHERE id = ${ROWS}`);
  console.log("ok: extra-connector price (omitted = identical bytes, partial written, refused), deletable per product state");

  // ── 6. FK actions ──────────────────────────────────────────────────────
  await db.execute(sql`DELETE FROM phone_numbers WHERE id = ${id(0x504)}`);
  assert.equal(await count(sql`SELECT count(*)::int AS n FROM connectors WHERE id = ${C2} AND phone_number_id IS NULL`), 1, "number delete → SET NULL");
  await db.execute(sql`DELETE FROM connectors WHERE id = ${C1}`);
  assert.equal(await count(sql`SELECT count(*)::int AS n FROM calls WHERE user_id = ${ROWS} AND connector_id IS NULL`), 3, "connector delete → calls kept, SET NULL");
  await db.execute(sql`DELETE FROM users WHERE id = ${GONE}`);
  assert.equal(await count(sql`SELECT count(*)::int AS n FROM connectors WHERE user_id = ${GONE}`), 0, "user delete cascades");
  console.log("ok: FK actions (number SET NULL, connector SET NULL on calls, user CASCADE)");

  console.log("ALL CONNECTORS DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
