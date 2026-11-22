// Products against a THROWAWAY Postgres, through the real code:
//   1. accountProducts over real rows, one per entitlement rule (and invalid
//      records, an unknown account, the admin target);
//   2. the catalogue over the real app_settings row: absent → defaults,
//      stored → served, invalid → defaults + the invalid hook;
//   3. the four gate cases of /api/admin/product-catalogue (signed out 401,
//      a tenant 403 with nothing written, an admin partial write, an
//      unchanged re-send, an omitted field / empty body = unchanged), plus
//      400 on an invalid write with nothing written;
//   4. GET /api/public/plan-pricing: the new `products` field, the plan keys
//      unchanged;
//   5. billing-stats: the response is byte-identical whatever the catalogue
//      row holds and for no / an invalid users.products record; a valid
//      record only ADDS usageByProduct (P2).
// The session is a test double (module hooks,
// scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs); nothing is sent.
// Plain `npm test` skips it. Run it with:  bash scripts/products-db.sh
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read
// from the shell. Mock data only (example.test). Dynamic imports only after
// the env checks.

import assert from "node:assert/strict";

const url = process.env.PRODUCTS_DB_TEST_URL;
if (!url) {
  console.log("skip: products DB part (no PRODUCTS_DB_TEST_URL — see scripts/products-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /^(LIVEKIT|TWILIO|RESEND|WHATSAPP|GOOGLE)|OPENAI|REALTIME_API_KEY|EMAIL_FROM/i.test(k))) {
  throw new Error("refusing to run with provider env set");
}
if (!(globalThis as { __campgateHooks?: boolean }).__campgateHooks) throw new Error("module hooks missing: run through scripts/products-db.sh");
process.env.DATABASE_URL = url;

const g = globalThis as { __campgateSession?: { user: { id: string } } | null };
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ADMIN = id(0xad);
const TENANT = id(0x71);

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { accountProducts, getProductCatalogue } = await import("../../lib/products");
  const { DEFAULT_PRODUCT_CATALOGUE } = await import("../../lib/product-catalogue");
  const { SETTING_KEYS, getSetting, setSetting } = await import("../../lib/settings");
  const { PLANS, OVERAGE_RATE_ILS_PER_MIN } = await import("../../lib/plans");
  const adminRoute = await import("../../app/api/admin/product-catalogue/route");
  const publicRoute = await import("../../app/api/public/plan-pricing/route");
  const billing = await import("../../app/api/dashboard/billing-stats/route");

  const KEY = SETTING_KEYS.PRODUCT_CATALOGUE;
  const NO_OVERRIDES = { reception: null, reception_multi: null, sales: null, connect: null };
  assert.equal(KEY, "product_catalogue_v1");
  const clearCatalogue = () => db.execute(sql`DELETE FROM app_settings WHERE key = ${KEY}`);
  const setProducts = (uid: string, v: unknown) =>
    db.execute(sql`UPDATE users SET products = ${v === null ? null : JSON.stringify(v)}::jsonb WHERE id = ${uid}`);

  await db.execute(sql`DELETE FROM users WHERE email LIKE '%@products.example.test'`);
  await clearCatalogue();
  type Seed = [number, string, string, unknown];
  const seeds: Seed[] = [
    [0xad, "premium", "active", null],
    [0x71, "global", "active", null],
    [0x01, "essential", "trialing", null],
    [0x02, "premium", "trial_paused", null],
    [0x03, "global", "active", null],
    [0x04, "whatsapp", "canceled", null],
    [0x05, "premium", "active", null],
    [0x06, "essential", "active", null],
    [0x07, "platinum", "active", null],
    [0x08, "premium", "trialing", { base: "sales", addons: [] }],
    [0x09, "global", "active", { base: "connect", addons: ["sales", "connect"] }],
    [0x0a, "global", "active", { base: "gold", addons: [] }],
    [0x0b, "whatsapp", "trialing", { base: "reception" }],
    [0x0c, "premium", "active", "reception"],
  ];
  for (const [n, plan, status, products] of seeds) {
    await db.execute(sql`INSERT INTO users (id, email, password_hash, role, subscription_plan, subscription_status, products)
      VALUES (${id(n)}, ${`u${n}@products.example.test`}, 'x', ${n === 0xad ? "admin" : "user"}, ${plan}, ${status},
              ${products === null ? null : JSON.stringify(products)}::jsonb)`);
  }

  // ── 1. accountProducts over real rows ──────────────────────────────────
  const GF = (base: string, addons: string[], entries: string[]) => ({ base, addons, entries, source: "grandfathered" });
  const want: Array<[number, unknown]> = [
    [0x01, GF("reception_multi", [], ["reception"])],
    [0x02, GF("reception_multi", [], ["reception"])],
    [0x03, GF("reception", [], ["reception"])],
    [0x04, GF("reception", [], ["reception"])],
    [0x05, GF("reception_multi", ["sales"], ["reception", "sales"])],
    [0x06, GF("reception_multi", ["sales"], ["reception", "sales"])],
    [0x07, GF("reception_multi", ["sales"], ["reception", "sales"])],
    [0x08, { base: "sales", addons: [], entries: ["sales"], source: "products" }],
    [0x09, { base: "connect", addons: ["sales"], entries: ["sales", "connect"], source: "products" }],
    [0x0a, GF("reception", [], ["reception"])],
    [0x0b, GF("reception_multi", [], ["reception"])],
    [0x0c, GF("reception_multi", ["sales"], ["reception", "sales"])],
  ];
  // P3 added `trials` ADDITIVELY: with no trial row, every entry is
  // "available" and the rest is exactly the P1 result.
  const NO_TRIALS = { reception: { state: "available" }, sales: { state: "available" }, connect: { state: "available" } };
  const withTrials = (w: unknown) => ({ ...(w as object), trials: NO_TRIALS });
  for (const [n, w] of want) assert.deepEqual(await accountProducts(id(n)), withTrials(w), `accountProducts u${n}`);
  assert.deepEqual(await accountProducts(id(0xfff)), withTrials({ base: null, addons: [], entries: [], source: "grandfathered" }), "unknown account");
  console.log(`ok: accountProducts over ${want.length} real rows`);

  // ── 2. The catalogue over the real row ─────────────────────────────────
  let invalid = 0;
  const deps = { read: getSetting, onInvalid: () => void invalid++ };
  assert.deepEqual(await getProductCatalogue(deps), DEFAULT_PRODUCT_CATALOGUE, "absent → defaults");
  const edited = structuredClone(DEFAULT_PRODUCT_CATALOGUE);
  edited.reception.EUR.minutes = 260;
  await setSetting(KEY, JSON.stringify(edited));
  assert.deepEqual(await getProductCatalogue(deps), edited, "stored row served");
  await setSetting(KEY, JSON.stringify({ ...edited, gold: {} }));
  assert.deepEqual(await getProductCatalogue(deps), DEFAULT_PRODUCT_CATALOGUE, "invalid row → defaults");
  assert.equal(invalid, 1, "invalid row hook fired once");
  await clearCatalogue();
  console.log("ok: catalogue row absent / stored / invalid");

  // ── 3. Admin route: the gate cases ─────────────────────────────────────
  const call = async (as: string | null, method: "GET" | "PUT", body?: unknown) => {
    g.__campgateSession = as ? { user: { id: as } } : null;
    const req = new NextRequest("http://localhost/api/admin/product-catalogue", {
      method,
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
    const res = method === "GET" ? await adminRoute.GET() : await adminRoute.PUT(req);
    return { status: res.status, body: await res.json() };
  };
  const storedRaw = () => getSetting(KEY);
  assert.deepEqual(await call(null, "GET"), { status: 401, body: { error: "unauthorized" } });
  assert.deepEqual(await call(null, "PUT", { catalogue: { sales: { EUR: { monthly: 1 } } } }), { status: 401, body: { error: "unauthorized" } });
  assert.deepEqual(await call(TENANT, "GET"), { status: 403, body: { error: "forbidden" } });
  assert.deepEqual(await call(TENANT, "PUT", { catalogue: { sales: { EUR: { monthly: 1 } } } }), { status: 403, body: { error: "forbidden" } });
  assert.equal(await storedRaw(), null, "a refused write writes nothing");
  {
    // E2 added engineOverrides + engineOptions ADDITIVELY (scripts/engine-override-db.sh covers them).
    const r = await call(ADMIN, "GET");
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body), ["catalogue", "engineOverrides", "engineOptions"]);
    assert.deepEqual(r.body.catalogue, DEFAULT_PRODUCT_CATALOGUE);
    assert.deepEqual(r.body.engineOverrides, NO_OVERRIDES);
  }
  // (1) the admin changes one field: only it changes.
  {
    const r = await call(ADMIN, "PUT", { catalogue: { sales: { ILS: { monthly: 579, annual: 5790 } } } });
    const exp = structuredClone(DEFAULT_PRODUCT_CATALOGUE);
    exp.sales.ILS.monthly = 579;
    exp.sales.ILS.annual = 5790;
    assert.deepEqual(r, { status: 200, body: { ok: true, catalogue: exp, engineOverrides: NO_OVERRIDES } });
    assert.deepEqual(JSON.parse((await storedRaw())!), exp);
  }
  const afterWrite = await storedRaw();
  // (2) an unchanged re-send passes and rewrites nothing.
  {
    const cur = (await call(ADMIN, "GET")).body.catalogue;
    await db.execute(sql`UPDATE app_settings SET updated_at = '2020-01-01T00:00:00Z' WHERE key = ${KEY}`);
    assert.deepEqual(await call(ADMIN, "PUT", { catalogue: cur }), { status: 200, body: { ok: true, catalogue: cur, engineOverrides: NO_OVERRIDES } });
    const [r] = (await db.execute(sql`SELECT updated_at FROM app_settings WHERE key = ${KEY}`)) as unknown as Array<{ updated_at: Date | string }>;
    assert.equal(new Date(r.updated_at).toISOString(), "2020-01-01T00:00:00.000Z", "an unchanged re-send writes nothing");
  }
  // (3) an omitted field / empty body / no body leaves the stored value.
  for (const body of [{}, { catalogue: {} }, { catalogue: { connect: { EUR: { minutes: 100 } } } }, undefined, "not json"]) {
    const r = await call(ADMIN, "PUT", body);
    assert.equal(r.status, 200, `omitted ${JSON.stringify(body)}`);
    assert.equal(await storedRaw(), afterWrite, `omitted ${JSON.stringify(body)} keeps the stored row`);
  }
  // (4) an invalid write → 400 naming the fields, nothing written.
  assert.deepEqual(await call(ADMIN, "PUT", { catalogue: { sales: { ILS: { monthly: -5 } }, reception_multi: { EUR: { addonMonthly: 9 } } } }), {
    status: 400,
    body: { error: "invalid_catalogue", fields: ["catalogue.sales.ILS.monthly", "catalogue.reception_multi.EUR.addonMonthly"] },
  });
  assert.equal(await storedRaw(), afterWrite, "an invalid write writes nothing");
  // A tenant cannot change it either after an admin wrote it.
  assert.equal((await call(TENANT, "PUT", { catalogue: { sales: { ILS: { monthly: 1 } } } })).status, 403);
  assert.equal(await storedRaw(), afterWrite);
  console.log("ok: admin catalogue route gate cases");

  // ── 4. Public pricing: additive `products` ─────────────────────────────
  {
    const res = await publicRoute.GET();
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /s-maxage=60/);
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), [...PLANS.map((p) => p.key), "products"]);
    assert.deepEqual(body.products, JSON.parse(afterWrite!));
  }
  console.log("ok: public pricing carries products, plan keys first and unchanged");

  // ── 5. billing-stats: users.products only ADDS usageByProduct ─────────
  // An invariant, not a diff: for one account the response is byte-identical
  // whatever the catalogue row holds; a valid users.products record adds the
  // usageByProduct field and changes nothing else (P2).
  const U = id(0x03);
  await db.execute(sql`UPDATE users SET paid_until = '2030-01-15T00:00:00Z', locale = 'he' WHERE id = ${U}`);
  const stats = async () => {
    g.__campgateSession = { user: { id: ADMIN } };
    const res = await billing.GET(new NextRequest(`http://localhost/api/dashboard/billing-stats?asUserId=${U}`));
    assert.equal(res.status, 200);
    return res.text();
  };
  await clearCatalogue();
  await setProducts(U, null);
  const base = await stats();
  const global = PLANS.find((p) => p.key === "global")!;
  assert.deepEqual(JSON.parse(base).usage, { minutesUsed: 0, minutesIncluded: global.minutesIncluded, overageRateIls: OVERAGE_RATE_ILS_PER_MIN });
  assert.ok(!base.includes('"products"'), "billing-stats serves no products field");
  const wild = structuredClone(DEFAULT_PRODUCT_CATALOGUE);
  for (const p of Object.keys(wild) as (keyof typeof wild)[])
    for (const c of ["EUR", "ILS"] as const) {
      wild[p][c].minutes += 1000;
      wild[p][c].overagePerMin += 7;
    }
  const records: unknown[] = [null, { base: "sales", addons: ["connect"] }, { base: "reception", addons: [] }, { base: "gold", addons: [] }, "reception"];
  for (const row of [null, JSON.stringify(wild), "{broken"]) {
    if (row === null) await clearCatalogue();
    else await setSetting(KEY, row);
    for (const rec of records) {
      await setProducts(U, rec);
      const got = await stats();
      const label = `catalogue ${row ? row.slice(0, 12) : "absent"}, products ${JSON.stringify(rec)}`;
      // P2: a VALID record adds usageByProduct (and only that); no record or
      // an invalid one stays byte-identical (scripts/products-usage-db.sh).
      const valid = rec !== null && typeof rec === "object" && ["sales", "reception"].includes((rec as { base: string }).base);
      if (valid) {
        const { usageByProduct, ...rest } = JSON.parse(got) as Record<string, unknown>;
        assert.ok(usageByProduct, `usageByProduct for a valid record: ${label}`);
        assert.equal(JSON.stringify(rest), base, `byte-identical minus usageByProduct: ${label}`);
      } else {
        assert.equal(got, base, `byte-identical: ${label}`);
      }
    }
  }
  await setProducts(U, null);
  await clearCatalogue();
  console.log("ok: billing-stats byte-identical whatever the catalogue holds; a valid record only adds usageByProduct");

  console.log("ALL PRODUCTS DB TESTS PASSED");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
