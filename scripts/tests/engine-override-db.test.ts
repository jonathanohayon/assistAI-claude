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
//      for byte, and ONE admin alert (deduplicated per account × product);
//   5. fail-open: each failure point inside the decision (catalogue row read,
//      accountProducts, the languages read, the client sales override read
//      (E2b), the alert sink) → the handler's
//      response is byte-identical to the no-override response, for inbound,
//      campaign and outbound_test, and ONE deduplicated fail-open alert.
//   6. the client sales override (E2b, users.sales_engine_override) through
//      PUT /api/admin/users/[userId]/engine: the gate cases (signed out /
//      tenant refused, nothing written), an admin set, an unchanged re-send
//      (row not rewritten), omitted = unchanged, not honoured / malformed →
//      400 naming the field with nothing written, null clears (SQL NULL);
//      GET shows the sales entry's source "client"; the campaign payload
//      follows it over the product override; an ignored one falls through to
//      the product override with ONE deduplicated alert.
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
  const { buildInboundConfig, LIVE_INBOUND_EFFECTS } = await import("../../lib/agent/session-config/inbound");
  const { handleCampaignConfig } = await import("../../lib/agent/session-config/campaign");
  const { handleOutboundTestConfig } = await import("../../lib/agent/session-config/outbound-test");
  const { engineDecisionFailedAlertKey } = await import("../../lib/engine-override-load");

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
    assert.deepEqual(xaiDefault, { engine: "xai", model: null, honoured: true, languages: ["fr", "en"], costPerMinUsd: 0.08 }, "language coverage + cost per option");
    // Additive: the options minus costPerMinUsd are the pre-change output, byte for byte.
    const { engineOptionCoverage } = await import("../../lib/engine-override");
    const { honouredOptions } = await import("../../lib/engine-resolve");
    const { getEngineLanguages } = await import("../../lib/engine-languages-storage");
    const langs = await getEngineLanguages();
    const strip = (x: Record<string, { honoured: unknown; options: Array<Record<string, unknown>> }>) =>
      Object.fromEntries(Object.entries(x).map(([p, v]) => [p, { honoured: v.honoured, options: v.options.map(({ costPerMinUsd: _c, ...rest }) => rest) }]));
    const old = Object.fromEntries(Object.keys(r.body.engineOptions).map((p) => [p, { honoured: honouredOptions(p as never), options: engineOptionCoverage(p as never, langs) }]));
    assert.equal(JSON.stringify(strip(r.body.engineOptions)), JSON.stringify(old), "engineOptions minus costPerMinUsd = the old output");
    const { DEFAULT_COST_RATES } = await import("../../lib/finance/rates");
    const opts = r.body.engineOptions.reception.options as Array<{ engine: string; model: string | null; costPerMinUsd: number | null }>;
    assert.ok(opts.filter((o) => o.engine === "openai").every((o) => o.costPerMinUsd === DEFAULT_COST_RATES.openaiUsdPerMinute), "openai: flat placeholder");
    assert.ok(opts.filter((o) => o.engine === "gemini").every((o) => o.costPerMinUsd === null), "gemini: null");
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
    // The banner and the catalogue give the SAME number for the same engine/model.
    const catOpts = (await cat(ADMIN, "GET")).body.engineOptions;
    const recXai = catOpts.reception.options.find((o: { engine: string; model: string | null }) => o.engine === "xai" && o.model === null);
    assert.equal(c.costPerMinUsd, recXai.costPerMinUsd, "reception xai: banner = catalogue");
    const salesOpt = catOpts.sales.options.find((o: { engine: string; model: string | null }) => o.engine === "openai" && o.model === "gpt-realtime-2.1");
    const aSales = (await banner(ADMIN, A)).body.products[1];
    assert.equal(aSales.costPerMinUsd, salesOpt.costPerMinUsd, "sales openai 2.1: banner = catalogue");
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

  // ── 5. Fail-open on every call path ─────────────────────────────────────
  {
    type Deps = import("../../lib/engine-override-load").DecideDeps;
    type Alert = import("../../lib/engine-override-load").EngineAlert;
    class CatalogueReadError extends Error {}
    class EntitlementReadError extends Error {}
    class LanguagesReadError extends Error {}
    class AlertSinkError extends Error {}
    class ClientSalesReadError extends Error {}
    const throwingSink: Alert = async () => {
      throw new AlertSinkError("mock sink down");
    };
    const qIn = `userId=${C}`; // en, not client set: the reception override would apply
    const qCamp = `campaignId=${sid("d1")}&contactId=${sid("e1")}`;
    const qTest = `agentId=${sid("c1")}`;
    const req = (q: string) => new NextRequest(`http://localhost/x?${q}`, { headers: H });
    const run = {
      inbound: async (deps?: Deps, alert?: Alert) =>
        mask(await (await buildInboundConfig(new URLSearchParams(qIn), { ...LIVE_INBOUND_EFFECTS, engineDeps: deps, ...(alert ? { alertAdmins: alert } : {}) })).text()),
      campaign: async (deps?: Deps, alert?: Alert) => mask(await (await handleCampaignConfig(req(qCamp), { deps, alert })).text()),
      outbound_test: async (deps?: Deps, alert?: Alert) => mask(await (await handleOutboundTestConfig(req(qTest), { deps, alert })).text()),
    };
    // The no-override responses (no catalogue row at all).
    await clear();
    const base = { inbound: await run.inbound(), campaign: await run.campaign(), outbound_test: await run.outbound_test() };
    for (const k of Object.keys(base) as Array<keyof typeof base>) assert.match(base[k], /"voiceConfig"/, `${k}: a real payload`);
    // Both products overridden: without a failure every path's payload changes.
    await cat(ADMIN, "PUT", { catalogue: { reception: { engineOverride: { engine: "xai", model: null } }, sales: { engineOverride: { engine: "openai", model: "gpt-realtime-2.1" } } } });
    for (const k of Object.keys(base) as Array<keyof typeof base>) assert.notEqual(await run[k](), base[k], `${k}: the override applies when nothing fails`);
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${LEDGER_SETTING}`);
    await db.execute(sql`DELETE FROM events WHERE event = 'admin_alert_sent' AND metadata->>'key' LIKE 'engine_override_decision_failed:%'`);

    const failing: Array<[string, Deps, Array<keyof typeof base>]> = [
      ["catalogue row read", { overrides: async () => { throw new CatalogueReadError("mock"); } }, ["inbound", "campaign", "outbound_test"]],
      ["accountProducts", { entitled: async () => { throw new EntitlementReadError("mock"); } }, ["inbound"]], // sales reads no entitlement
      ["engine-languages read", { languages: async () => { throw new LanguagesReadError("mock"); } }, ["inbound", "campaign", "outbound_test"]],
      // E2b: the users.sales_engine_override read is inside the wrapped decision (inbound never reads it).
      ["client sales override read", { clientSalesOverride: async () => { throw new ClientSalesReadError("mock"); } }, ["campaign", "outbound_test"]],
    ];
    for (const [point, deps, on] of failing) {
      for (const k of on) {
        for (let i = 0; i < 2; i++) assert.equal(await run[k](deps), base[k], `${point} on ${k}: byte-identical to the no-override response`);
        assert.equal(await run[k](deps, throwingSink), base[k], `${point} on ${k} + the alert sink throwing: still identical, nothing propagates`);
      }
    }
    // E2b: ONLY the client sales override set (no catalogue row) and its read throws → today's bytes.
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${KEY}`);
    await db.execute(sql`UPDATE users SET sales_engine_override = '{"engine":"openai","model":"gpt-realtime-2.1"}'::jsonb WHERE id IN (${A}, ${B})`);
    for (const k of ["campaign", "outbound_test"] as const) {
      assert.notEqual(await run[k](), base[k], `${k}: the client sales override applies when nothing fails`);
      const deps: Deps = { clientSalesOverride: async () => { throw new ClientSalesReadError("mock"); } };
      assert.equal(await run[k](deps), base[k], `client sales override read throws on ${k} (no product override): byte-identical`);
      assert.equal(await run[k](deps, throwingSink), base[k], `client sales override read throws on ${k} + the sink throwing: identical`);
    }
    assert.equal(await run.inbound({ clientSalesOverride: async () => { throw new ClientSalesReadError("mock"); } }), base.inbound, "inbound never reads it");
    await db.execute(sql`UPDATE users SET sales_engine_override = NULL`);
    // ONE fail-open alert per product family despite every repeat (24 h dedup).
    await new Promise((r) => setTimeout(r, 200));
    const raw = await getSetting(LEDGER_SETTING);
    const failedKeys = raw ? Object.keys(JSON.parse(raw)).filter((k) => k.startsWith("engine_override_decision_failed:")).sort() : [];
    const delivered = shouldDeliver("warning", new Date());
    assert.deepEqual(failedKeys, delivered ? [engineDecisionFailedAlertKey("reception"), engineDecisionFailedAlertKey("sales")] : [], "one ledger entry per product family (none in quiet hours)");
    for (const fam of ["reception", "sales"] as const) {
      const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM events WHERE event = 'admin_alert_sent' AND metadata->>'key' = ${engineDecisionFailedAlertKey(fam)}`)) as unknown as Array<{ n: number }>;
      assert.equal(n, delivered ? 1 : 0, `${fam}: the fail-open alert went out once, deduplicated`);
    }
    // The alert sink itself throwing (the ignored-override alert): b (he) with
    // Grok on reception → ignored; sales with OpenAI speaking no French → ignored.
    {
      const sinkOnly = async (deps?: Deps) => mask(await (await buildInboundConfig(new URLSearchParams(`userId=${B}`), { ...LIVE_INBOUND_EFFECTS, engineDeps: deps, alertAdmins: throwingSink })).text());
      await clear();
      const baseB = await sinkOnly();
      await cat(ADMIN, "PUT", { catalogue: { reception: { engineOverride: { engine: "xai", model: null } }, sales: { engineOverride: { engine: "openai", model: "gpt-realtime-2.1" } } } });
      assert.equal(await sinkOnly(), baseB, "alert sink throwing on the ignored alert (inbound) → identical");
      const noFr: Deps = { languages: async () => ({ openai: { "*": ["en"] }, gemini: { "*": ["fr", "en"] }, xai: { "*": ["fr", "en"] } }) };
      assert.equal(await run.campaign(noFr, throwingSink), base.campaign, "alert sink throwing on the ignored alert (campaign) → identical");
      assert.equal(await run.outbound_test(noFr, throwingSink), base.outbound_test, "alert sink throwing on the ignored alert (outbound_test) → identical");
    }
    await clear();
    console.log(`ok: fail-open (5 failure points × inbound / campaign / outbound_test → today's bytes; ${delivered ? "one deduplicated alert per product" : "no alert in quiet hours"})`);
  }

  // ── 6. The client sales override (E2b) ─────────────────────────────────
  const eng = async (as: string | null, userId: string, body: unknown) => {
    g.__campgateSession = as ? { user: { id: as } } : null;
    const req = new Request(`http://localhost/api/admin/users/${userId}/engine`, {
      method: "PUT",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
    const res = await engineRoute.PUT(req, { params: Promise.resolve({ userId }) });
    return { status: res.status, body: await res.json() };
  };
  type Raw = { v: unknown; isnull: boolean; x: string };
  const rawOf = async (userId: string): Promise<Raw> => {
    const [r] = (await db.execute(sql`SELECT sales_engine_override AS v, sales_engine_override IS NULL AS isnull, xmin::text AS x FROM users WHERE id = ${userId}`)) as unknown as Raw[];
    return r;
  };
  const SET21 = { salesOverride: { engine: "openai", model: "gpt-realtime-2.1" } };
  await clear();
  assert.equal((await rawOf(A)).isnull, true, "NULL by default");
  const campaignA = async () => mask(await viaSession(`origin=campaign&campaignId=${sid("d1")}&contactId=${sid("e1")}`));
  const todayCampaignA = await campaignA();
  assert.deepEqual(await eng(null, A, SET21), { status: 401, body: { error: "unauthorized" } });
  assert.deepEqual(await eng(TENANT, A, SET21), { status: 403, body: { error: "forbidden" } });
  assert.deepEqual(await eng(TENANT, TENANT, SET21), { status: 403, body: { error: "forbidden" } }, "a tenant can't set its own");
  assert.equal((await rawOf(A)).isnull, true, "a refused write writes nothing");
  assert.equal((await rawOf(TENANT)).isnull, true);
  assert.deepEqual(await eng(ADMIN, sid("ff"), SET21), { status: 404, body: { error: "user_not_found" } });
  // Admin sets it.
  assert.deepEqual(await eng(ADMIN, A, SET21), { status: 200, body: { ok: true, ...SET21 } });
  {
    const r = await rawOf(A);
    assert.deepEqual(r.v, SET21.salesOverride, "stored as { engine, model }");
    for (const u of [B, C, ADMIN, TENANT]) assert.equal((await rawOf(u)).isnull, true, "only that account written");
  }
  const xminSet = (await rawOf(A)).x;
  // An unchanged re-send rewrites nothing; omitted keeps the value.
  assert.deepEqual(await eng(ADMIN, A, SET21), { status: 200, body: { ok: true, ...SET21 } });
  for (const body of [{}, { salesOverride: undefined }]) {
    assert.deepEqual(await eng(ADMIN, A, body), { status: 200, body: { ok: true, ...SET21 } }, `omitted ${JSON.stringify(body)}`);
  }
  assert.equal((await rawOf(A)).x, xminSet, "re-send / omitted: the row is not rewritten");
  // Invalid / not honoured → 400 naming the field, nothing written.
  for (const [body, fields] of [
    [{ salesOverride: { engine: "gemini", model: null } }, ["salesOverride.engine"]],
    [{ salesOverride: { engine: "xai", model: REALTIME_PROVIDER_MODEL.xai } }, ["salesOverride.engine"]],
    [{ salesOverride: { engine: "openai" } }, ["salesOverride"]],
    [{ salesOverride: { engine: "openai", model: "gpt realtime" } }, ["salesOverride"]],
    [{ salesOverride: null, reception: null }, ["reception"]],
    ["not json", ["body"]],
  ] as const) {
    assert.deepEqual(await eng(ADMIN, A, body), { status: 400, body: { error: "invalid_engine_override", fields } }, `${JSON.stringify(body)} refused`);
    assert.equal((await rawOf(A)).x, xminSet, `${JSON.stringify(body)}: nothing written`);
  }
  // GET: the sales entry's source is "client"; the stored value is shown.
  {
    const r = await banner(ADMIN, A);
    assert.deepEqual(r.body.salesOverride, SET21.salesOverride);
    const sales = r.body.products.find((p: { product: string }) => p.product === "sales");
    assert.deepEqual(sales.resolved, { engine: "openai", model: "gpt-realtime-2.1", source: "client" });
    assert.equal(sales.ignored, undefined);
    assert.equal(r.body.products[0].resolved.source, "client", "reception_multi: its own (inbound) client setting, unchanged");
    assert.equal((await banner(ADMIN, B)).body.salesOverride, null);
  }
  // The call path: the campaign payload follows it (model only), above a product override.
  await cat(ADMIN, "PUT", { catalogue: { sales: { engineOverride: { engine: "openai", model: "gpt-realtime-mini" } } } });
  {
    const t = await campaignA();
    assert.notEqual(t, todayCampaignA);
    assert.match(t, /"model":"gpt-realtime-2\.1"/, "client beats product");
    assert.doesNotMatch(t, /gpt-realtime-mini|salesOverride|sales_engine_override|engineOverride/, "never served: only the resolved model");
    assert.equal(t.replaceAll("gpt-realtime-2.1", "gpt-realtime"), todayCampaignA, "only the model leaves move");
  }
  // An ignored client override (hand-written gemini, language unsupported) falls through to the product override, alerting once.
  await db.execute(sql`UPDATE users SET sales_engine_override = '{"engine":"gemini","model":null}'::jsonb WHERE id = ${A}`);
  await db.execute(sql`DELETE FROM app_settings WHERE key = ${LEDGER_SETTING}`);
  for (let i = 0; i < 3; i++) assert.match(await campaignA(), /"model":"gpt-realtime-mini"/, "not honoured → the product override");
  {
    const sales = (await banner(ADMIN, A)).body.products.find((p: { product: string }) => p.product === "sales");
    assert.deepEqual(sales.resolved, { engine: "openai", model: "gpt-realtime-mini", source: "product" });
    assert.deepEqual(sales.ignored, { reason: "not_honoured", wanted: { source: "client", engine: "gemini", model: null } });
  }
  await new Promise((r) => setTimeout(r, 200));
  const deliveredSales = shouldDeliver("warning", new Date());
  assert.deepEqual(await ledger(), deliveredSales ? [engineIgnoredAlertKey(A, "sales")] : [], "ONE ledger entry (none in quiet hours)");
  // A malformed stored value = no override (falls to the product override, no throw).
  await db.execute(sql`UPDATE users SET sales_engine_override = '"openai"'::jsonb WHERE id = ${A}`);
  assert.match(await campaignA(), /"model":"gpt-realtime-mini"/, "malformed → the product override");
  assert.equal((await banner(ADMIN, A)).body.salesOverride, null);
  // The admin route replaces a malformed value; null clears to SQL NULL.
  assert.equal((await eng(ADMIN, A, SET21)).status, 200);
  assert.deepEqual((await rawOf(A)).v, SET21.salesOverride);
  assert.deepEqual(await eng(ADMIN, A, { salesOverride: null }), { status: 200, body: { ok: true, salesOverride: null } });
  assert.equal((await rawOf(A)).isnull, true, "null clears to SQL NULL");
  await clear();
  assert.equal(await campaignA(), todayCampaignA, "cleared everywhere → today's payload, byte for byte");
  console.log(`ok: client sales override (gates, set, re-send, omitted, refused, clear, GET source client, payload, fall-through + ${deliveredSales ? "one alert" : "no alert in quiet hours"})`);

  // ── 7. Old own-agent mechanism + new client agent both set (fail-open) ──
  // Account B: tenant_agent_brain ON and tools_config.clientAgent enabled with
  // a url. The alert path never changes the payload: identical bytes with a
  // silent sink, a collecting sink, a sink that throws synchronously, one that
  // rejects, and the live one; the live sink records ONE ledger entry per
  // account per day (none in quiet hours). Mock urls only (example.test).
  {
    const { legacyBrainOverlapAlertKey } = await import("../../lib/agent/legacy-brain-overlap");
    const BRAIN = "tenant_agent_brain";
    await clear();
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${BRAIN}`);
    const runB = async (alert?: (a: unknown) => Promise<unknown>) =>
      mask(await (await buildInboundConfig(new URLSearchParams(`userId=${B}`), { ...LIVE_INBOUND_EFFECTS, ...(alert ? { alertAdmins: alert } : {}) })).text());
    const silent = async () => false;
    const before = await runB(silent);
    const [{ tc: toolsBefore }] = (await db.execute(sql`SELECT tools_config::text AS tc FROM agent_configs WHERE user_id = ${B}`)) as unknown as Array<{ tc: string | null }>;
    await db.execute(sql`INSERT INTO app_settings (key, value) VALUES (${BRAIN}, ${JSON.stringify({ [B]: { enabled: true, url: "https://legacy.example.test/hook" } })})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    // A full, valid stored Tools value (parseTools is strict), the client agent set.
    const { toolsFromTileToggles } = await import("../../lib/tools/adapters");
    const { getTileToggles } = await import("../../lib/tile-toggles");
    const storedTools = {
      ...toolsFromTileToggles(await getTileToggles(B)),
      clientAgent: { enabled: true, url: "https://new.example.test/agent", mode: "lead", secret: null },
    };
    await db.execute(sql`UPDATE agent_configs SET tools_config = ${JSON.stringify(storedTools)}::jsonb WHERE user_id = ${B}`);
    const isOverlapKey = (a: unknown) => String((a as { key?: unknown }).key).startsWith("agent_brain_overlap:");
    const seen: Array<{ key: string; body: string; subject: string }> = [];
    const collect = async (a: unknown) => (isOverlapKey(a) && seen.push(a as { key: string; body: string; subject: string }), true);
    // The throws target the overlap alert only (the other call-path alerts
    // keep a silent sink, so the test isolates the new path).
    const isOverlap = (a: unknown) => String((a as { key?: unknown }).key).startsWith("agent_brain_overlap:");
    const syncThrow = ((a: unknown) => {
      if (isOverlap(a)) throw new Error("mock sink down (sync)");
      return Promise.resolve(false);
    }) as (a: unknown) => Promise<unknown>;
    const rejects = async (a: unknown) => {
      if (isOverlap(a)) throw new Error("mock sink down (async)");
      return false;
    };
    const baseline = await runB(silent);
    assert.match(baseline, /"voiceConfig"/, "a real payload");
    for (const [name, sink] of [["collecting", collect], ["sync throw", syncThrow], ["rejecting", rejects]] as const) {
      assert.equal(await runB(sink), baseline, `overlap alert sink ${name}: payload byte-identical`);
    }
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(seen.length, 1, "the collecting sink was called once for the overlapping account");
    assert.equal(seen[0].key, legacyBrainOverlapAlertKey(B));
    assert.doesNotMatch(`${seen[0].subject}\n${seen[0].body}`, /example\.test|https?:|@|secret-/, "no url, email nor secret in the alert");
    // An account without the overlap: no alert.
    const seenC: unknown[] = [];
    await buildInboundConfig(new URLSearchParams(`userId=${C}`), { ...LIVE_INBOUND_EFFECTS, alertAdmins: async (a: unknown) => (seenC.push(a), true) });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(seenC.filter((a) => (a as { key: string }).key.startsWith("agent_brain_overlap:")).length, 0, "no overlap → no alert");
    // The live sink: once per account per day through the alert ledger.
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${LEDGER_SETTING}`);
    for (let i = 0; i < 3; i++) assert.equal(await runB(), baseline, "live sink: payload byte-identical");
    await new Promise((r) => setTimeout(r, 300));
    const delivered = shouldDeliver("warning", new Date());
    const raw = await getSetting(LEDGER_SETTING);
    const keys = raw ? Object.keys(JSON.parse(raw)).filter((k) => k.startsWith("agent_brain_overlap:")) : [];
    assert.deepEqual(keys, delivered ? [legacyBrainOverlapAlertKey(B)] : [], "ONE ledger entry per account per day (none in quiet hours)");
    const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM events WHERE event = 'admin_alert_sent' AND metadata->>'key' = ${legacyBrainOverlapAlertKey(B)}`)) as unknown as Array<{ n: number }>;
    assert.equal(n, delivered ? 1 : 0, "the overlap alert went out once");
    // The daily digest's count reads the same map.
    const { countEnabledLegacyBrains } = await import("../../lib/agent-brain");
    assert.equal(await countEnabledLegacyBrains(), 1);
    // Restore B (the overlap only changed what the alert sees, never `before`'s shape).
    await db.execute(sql`DELETE FROM app_settings WHERE key IN (${BRAIN}, ${LEDGER_SETTING})`);
    await db.execute(sql`UPDATE agent_configs SET tools_config = ${toolsBefore}::jsonb WHERE user_id = ${B}`);
    assert.equal(await runB(silent), before, "restored → the pre-section payload");
    console.log(`ok: old+new agent overlap (payload byte-identical with 4 sinks; ${delivered ? "one deduplicated alert" : "no alert in quiet hours"})`);
  }

  console.log("ALL ENGINE-OVERRIDE DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
