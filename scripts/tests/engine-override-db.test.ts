// The engine override per product (E2) against a THROWAWAY Postgres, through
// the real code (the payload snapshots (b)/(c) live in scripts/engine-override-db.sh):
//   1. /api/admin/product-catalogue carries `engineOverride`: the gate cases
//      (signed out 401, a tenant 403, nothing written), an admin set, an
//      unchanged re-send (nothing rewritten), omitted = unchanged (a price
//      write keeps it), null clears (the pre-E2 bytes again), not honoured →
//      400 naming it with nothing written; GET returns honoured options +
//      language coverage per product;
//   2. GET /api/public/plan-pricing never carries the override;
//   3. GET /api/admin/users/[userId]/engine: gate cases, then per product
//      entry the SAME decision as the call path (client / product / default,
//      ignored, cost per minute);
//   4. the language guard on the call path: an override to an engine that
//      does not speak the account's language → the payload is today's, byte
//      for byte, and ONE admin alert (deduplicated per account × product).
// The session is a test double (scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs).
// Plain `npm test` skips it. Run it with:  bash scripts/engine-override-db.sh
// Only a 127.0.0.1/localhost URL is accepted; mock data only (example.test).

import assert from "node:assert/strict";

const url = process.env.ENGINE_OVERRIDE_DB_TEST_URL;
if (!url) {
  console.log("skip: engine override DB part (no ENGINE_OVERRIDE_DB_TEST_URL — see scripts/engine-override-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /^(LIVEKIT|TWILIO|RESEND|WHATSAPP|GOOGLE)|OPENAI|REALTIME_API_KEY|EMAIL_FROM|ADMIN_ALERT/i.test(k))) {
  throw new Error("refusing to run with provider env set");
}
if (!(globalThis as { __campgateHooks?: boolean }).__campgateHooks) throw new Error("module hooks missing: run through scripts/engine-override-db.sh");
process.env.DATABASE_URL = url;
process.env.INTERNAL_SECRET = "mock-internal-secret";

const g = globalThis as { __campgateSession?: { user: { id: string } } | null };
const sid = (s: string) => `00000000-0000-0000-0000-${s.padStart(12, "0")}`; // the seed's ids
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const TENANT = "00000000-0000-4000-8000-000000000071";
const A = sid("a"); // premium → reception_multi + sales; client set (xai); fr
const B = sid("b"); // global → reception; not client set; he
const C = sid("c"); // global → reception; not client set; en

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { DEFAULT_PRODUCT_CATALOGUE } = await import("../../lib/product-catalogue");
  const { SETTING_KEYS, getSetting } = await import("../../lib/settings");
  const { LEDGER_SETTING } = await import("../../lib/alert-ledger");
  const { shouldDeliver } = await import("../../lib/monitoring-rules");
  const { engineIgnoredAlertKey } = await import("../../lib/engine-override-load");
  const { REALTIME_PROVIDER_MODEL } = await import("../../lib/realtime-provider");
  const catalogueRoute = await import("../../app/api/admin/product-catalogue/route");
  const engineRoute = await import("../../app/api/admin/users/[userId]/engine/route");
  const publicRoute = await import("../../app/api/public/plan-pricing/route");
  const configRoute = await import("../../app/api/agent/config/route");
  const sessionRoute = await import("../../app/api/agent/session-config/route");

  const KEY = SETTING_KEYS.PRODUCT_CATALOGUE;
  const NONE = { reception: null, reception_multi: null, sales: null, connect: null };
  const D = DEFAULT_PRODUCT_CATALOGUE;
  const storedRaw = () => getSetting(KEY);
  const clear = () => db.execute(sql`DELETE FROM app_settings WHERE key IN (${KEY}, ${LEDGER_SETTING})`);

  await db.execute(sql`DELETE FROM users WHERE email LIKE '%@engine.example.test'`);
  await db.execute(sql`INSERT INTO users (id, email, password_hash, role) VALUES
    (${ADMIN}, 'admin@engine.example.test', 'x', 'admin'), (${TENANT}, 'tenant@engine.example.test', 'x', 'user')`);
  // The seed's accounts default to "trialing" (reception_multi only): make
  // them paying accounts, so a (premium) is entitled to reception_multi +
  // sales and b / c (global) to reception.
  await db.execute(sql`UPDATE users SET subscription_status = 'active' WHERE id IN (${A}, ${B}, ${C})`);
  await clear();

  // ── 1. The catalogue route carries engineOverride ──────────────────────
  const cat = async (as: string | null, method: "GET" | "PUT", body?: unknown) => {
    g.__campgateSession = as ? { user: { id: as } } : null;
    const req = new NextRequest("http://localhost/api/admin/product-catalogue", {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
    const res = method === "GET" ? await catalogueRoute.GET() : await catalogueRoute.PUT(req);
    return { status: res.status, body: await res.json() };
  };
  const SET_REC = { catalogue: { reception: { engineOverride: { engine: "xai", model: null } } } };
  assert.deepEqual(await cat(null, "PUT", SET_REC), { status: 401, body: { error: "unauthorized" } });
  assert.deepEqual(await cat(TENANT, "PUT", SET_REC), { status: 403, body: { error: "forbidden" } });
  assert.deepEqual(await cat(TENANT, "GET"), { status: 403, body: { error: "forbidden" } });
  assert.equal(await storedRaw(), null, "a refused write writes nothing");
  {
    const r = await cat(ADMIN, "GET");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.engineOverrides, NONE);
    assert.deepEqual(r.body.engineOptions.sales.honoured, { openai: { engine: true, models: "any" }, gemini: { engine: false, models: [] }, xai: { engine: false, models: [] } });
    assert.deepEqual(r.body.engineOptions.reception.honoured.xai, { engine: true, models: [REALTIME_PROVIDER_MODEL.xai] });
    const xaiDefault = r.body.engineOptions.reception.options.find((o: { engine: string; model: string | null }) => o.engine === "xai" && o.model === null);
    assert.deepEqual(xaiDefault, { engine: "xai", model: null, honoured: true, languages: ["fr", "en"] }, "language coverage per option");
    assert.ok(r.body.engineOptions.connect.options.every((o: { honoured: boolean }) => !o.honoured));
  }
  // Admin sets the reception override.
  {
    const r = await cat(ADMIN, "PUT", SET_REC);
    assert.deepEqual(r, { status: 200, body: { ok: true, catalogue: D, engineOverrides: { ...NONE, reception: { engine: "xai", model: null } } } });
    const raw = JSON.parse((await storedRaw())!);
    assert.deepEqual(raw.reception.engineOverride, { engine: "xai", model: null });
    assert.equal(raw.sales.engineOverride, undefined, "only the product written");
  }
  const afterSet = await storedRaw();
  // An unchanged re-send rewrites nothing.
  {
    await db.execute(sql`UPDATE app_settings SET updated_at = '2020-01-01T00:00:00Z' WHERE key = ${KEY}`);
    assert.equal((await cat(ADMIN, "PUT", SET_REC)).status, 200);
    const [r] = (await db.execute(sql`SELECT updated_at FROM app_settings WHERE key = ${KEY}`)) as unknown as Array<{ updated_at: Date | string }>;
    assert.equal(new Date(r.updated_at).toISOString(), "2020-01-01T00:00:00.000Z", "an unchanged re-send writes nothing");
  }
  // Omitted = unchanged; a price write keeps the override.
  for (const body of [{}, { catalogue: {} }, { catalogue: { reception: {} } }]) {
    assert.equal((await cat(ADMIN, "PUT", body)).status, 200);
    assert.equal(await storedRaw(), afterSet, `omitted ${JSON.stringify(body)} keeps the row`);
  }
  {
    const r = await cat(ADMIN, "PUT", { catalogue: { connect: { ILS: { monthly: 219 } } } });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse((await storedRaw())!).reception.engineOverride, { engine: "xai", model: null }, "a price write keeps the override");
    assert.equal(JSON.parse((await storedRaw())!).connect.ILS.monthly, 219);
    await cat(ADMIN, "PUT", { catalogue: { connect: { ILS: { monthly: D.connect.ILS.monthly } } } });
    assert.equal(await storedRaw(), afterSet);
  }
  // Not honoured → 400 naming it, nothing written.
  for (const [body, field] of [
    [{ catalogue: { sales: { engineOverride: { engine: "gemini", model: null } } } }, "catalogue.sales.engineOverride.engine"],
    [{ catalogue: { reception: { engineOverride: { engine: "gemini", model: "gemini-other" } } } }, "catalogue.reception.engineOverride.model"],
    [{ catalogue: { connect: { engineOverride: { engine: "openai", model: null } } } }, "catalogue.connect.engineOverride.engine"],
    [{ catalogue: { reception: { engineOverride: { engine: "openai" } } } }, "catalogue.reception.engineOverride"],
  ] as const) {
    assert.deepEqual(await cat(ADMIN, "PUT", body), { status: 400, body: { error: "invalid_catalogue", fields: [field] } });
    assert.equal(await storedRaw(), afterSet, `${field}: nothing written`);
  }
  // ── 2. Public pricing never carries it ─────────────────────────────────
  {
    const res = await publicRoute.GET();
    const text = await res.text();
    assert.doesNotMatch(text, /engineOverride|xai|gemini|openai/, "the public response is prices only");
    assert.deepEqual(JSON.parse(text).products, D);
  }
  // null clears → the pre-E2 bytes.
  assert.equal((await cat(ADMIN, "PUT", { catalogue: { reception: { engineOverride: null } } })).status, 200);
  assert.equal(await storedRaw(), JSON.stringify(D), "cleared = JSON.stringify(prices), byte for byte");
  console.log("ok: catalogue route engineOverride (gates, set, re-send, omitted, clear, not honoured) + public pricing");

  // ── 3. The banner endpoint ─────────────────────────────────────────────
  const banner = async (as: string | null, userId: string) => {
    g.__campgateSession = as ? { user: { id: as } } : null;
    const res = await engineRoute.GET(new Request(`http://localhost/api/admin/users/${userId}/engine`), { params: Promise.resolve({ userId }) });
    return { status: res.status, body: await res.json() };
  };
  assert.deepEqual(await banner(null, B), { status: 401, body: { error: "unauthorized" } });
  assert.deepEqual(await banner(TENANT, B), { status: 403, body: { error: "forbidden" } });
  assert.deepEqual(await banner(ADMIN, sid("ff")), { status: 404, body: { error: "user_not_found" } });
  // No override: today's values.
  {
    const r = await banner(ADMIN, A);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.products.map((p: { product: string }) => p.product), ["reception_multi", "sales"]);
    assert.deepEqual(r.body.products[0].resolved, { engine: "xai", model: REALTIME_PROVIDER_MODEL.xai, source: "client" });
    assert.deepEqual(r.body.products[1].resolved, { engine: "openai", model: "gpt-realtime", source: "default" });
    assert.equal(typeof r.body.products[1].costPerMinUsd, "number");
  }
  await cat(ADMIN, "PUT", { catalogue: { reception: { engineOverride: { engine: "xai", model: null } }, sales: { engineOverride: { engine: "openai", model: "gpt-realtime-2.1" } } } });
  {
    const b = (await banner(ADMIN, B)).body.products[0];
    assert.deepEqual(b.resolved, { engine: "openai", model: "gpt-realtime-2", source: "default" });
    assert.deepEqual(b.ignored, { reason: "language", wanted: { source: "product", engine: "xai", model: null } });
    assert.equal(b.language, "he");
    const c = (await banner(ADMIN, C)).body.products[0];
    assert.deepEqual(c.resolved, { engine: "xai", model: REALTIME_PROVIDER_MODEL.xai, source: "product" });
    assert.equal(c.ignored, undefined);
    const a = (await banner(ADMIN, A)).body.products;
    assert.deepEqual(a[0].resolved.source, "client", "reception_multi: client set, no override for it anyway");
    assert.deepEqual(a[1].resolved, { engine: "openai", model: "gpt-realtime-2.1", source: "product" });
    assert.deepEqual(a[1].byLanguage?.map((x: { language: string }) => x.language) ?? [a[1].language], ["fr"]);
  }
  console.log("ok: banner endpoint (gates, today, product, ignored)");

  // ── 4. The language guard on the call path ─────────────────────────────
  const H = { "x-internal-secret": "mock-internal-secret" };
  const inbound = async (q: string) => (await configRoute.GET(new NextRequest(`http://localhost/x?${q}`, { headers: H }))).text();
  const viaSession = async (q: string) => (await sessionRoute.GET(new NextRequest(`http://localhost/x?${q}`, { headers: H }))).text();
  const mask = (t: string) => t.replace(/"updatedAt":"[^"]+"/g, '"updatedAt":"*"');
  await clear();
  const todayB = mask(await inbound(`userId=${B}`));
  const todaySessionB = mask(await viaSession(`origin=web&userId=${B}`));
  await cat(ADMIN, "PUT", SET_REC);
  await db.execute(sql`DELETE FROM app_settings WHERE key = ${LEDGER_SETTING}`);
  const ledger = async () => {
    const raw = await getSetting(LEDGER_SETTING);
    return raw ? Object.keys(JSON.parse(raw)).filter((k) => k.startsWith("engine_override_ignored:")) : [];
  };
  for (let i = 0; i < 3; i++) {
    assert.equal(mask(await inbound(`userId=${B}`)), todayB, "ignored override → today's payload, byte for byte");
    assert.equal(mask(await viaSession(`origin=web&userId=${B}`)), todaySessionB);
  }
  await new Promise((r) => setTimeout(r, 200)); // the alert is awaited, but leave the ledger write time
  const delivered = shouldDeliver("warning", new Date());
  assert.deepEqual(await ledger(), delivered ? [engineIgnoredAlertKey(B, "reception")] : [], "ONE ledger entry for account × product (none in quiet hours)");
  const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM events WHERE event = 'admin_alert_sent' AND metadata->>'key' = ${engineIgnoredAlertKey(B, "reception")}`)) as unknown as Array<{ n: number }>;
  assert.equal(n, delivered ? 1 : 0, "the alert went out once, deduplicated");
  // The applied override on C changes its payload (sanity: the wiring is live).
  assert.notEqual(mask(await inbound(`userId=${C}`)), "", "C served");
  assert.match(await inbound(`userId=${C}`), /"realtimeProvider":"xai"/);
  await clear();
  assert.doesNotMatch(await inbound(`userId=${C}`), /"realtimeProvider":"xai"/, "cleared → today's engine again");
  console.log(`ok: language guard (today's payload + ${delivered ? "one deduplicated alert" : "no alert in quiet hours"})`);

  console.log("ALL ENGINE-OVERRIDE DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
