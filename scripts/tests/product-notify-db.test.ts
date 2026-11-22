// "Prévenez-moi" (migration 0059 product_notify_requests) against a
// THROWAWAY Postgres, through the real code:
//   1. POST /api/dashboard/products/notify, the four gate cases (signed out
//      401, the tenant 201, an admin via ?asUserId 201, a non-admin with a
//      foreign ?asUserId 403 with nothing written), invalid 400, owned 409,
//      a repeat 200 with the ORIGINAL requestedAt, no message string;
//      409 only for what the MENU shows as owned (entitled AND gate on):
//      a grandfathered premium entitled to sales with dispatch off → 201;
//   2. concurrency: 10 parallel POSTs → exactly one row, every answer 201 or
//      200 with the same requestedAt; the unique + CHECK in the database;
//   3. accountProducts: the additive notifyRequested (PRODUCT_ENTRIES order);
//   4. GET /api/admin/product-notify: counts only (no id, no email), gated;
//   5. the FK cascade on user delete;
//   6. a record only: the route and its module import no mail / message code;
//   7. the menu rule: entitled/not × gate off/on (CLIENT_AGENT set in-process
//      AFTER the env guard), the admin ?asUserId uses the TARGET's role, and
//      the route agrees with menuFor for every account × env × entry.
// Plain `npm test` skips it. Run it with:  bash scripts/product-notify-db.sh
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read from
// the shell. Mock data only (example.test). Dynamic imports only after the
// env checks.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const url = process.env.PRODUCT_NOTIFY_DB_TEST_URL;
if (!url) {
  console.log("skip: product notify DB part (no PRODUCT_NOTIFY_DB_TEST_URL — see scripts/product-notify-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /^(LIVEKIT|TWILIO|RESEND|WHATSAPP|GOOGLE)|OPENAI|REALTIME_API_KEY|EMAIL_FROM|CAMPAIGN_DISPATCH|CLIENT_AGENT/i.test(k))) {
  throw new Error("refusing to run with provider env or product flags set");
}
if (!(globalThis as { __campgateHooks?: boolean }).__campgateHooks) throw new Error("module hooks missing: run through scripts/product-notify-db.sh");
process.env.DATABASE_URL = url;

const g = globalThis as { __campgateSession?: { user: { id: string; email?: string } } | null };
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ADMIN = id(0xad);
const TENANT = id(0x21); // record reception_multi: owns reception only
const OTHER = id(0x22); // another record account (admin target)
const GF = id(0x23); // grandfathered premium (owns reception + sales)
const RACE = id(0x24); // the concurrency account
const GONE = id(0x25); // deleted at the end (cascade)
// Section 7: one record account per entitlement subset (bit j = PRODUCT_ENTRIES[j]).
const SUBSET = (m: number) => id(0x100 + m);

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const notifyRoute = await import("../../app/api/dashboard/products/notify/route");
  const adminRoute = await import("../../app/api/admin/product-notify/route");
  const { accountProducts } = await import("../../lib/products");
  const { menuFor } = await import("../../lib/product-gates");
  const { featuresForPlan } = await import("../../lib/plan-features");
  const { getPlanFeatureMatrix } = await import("../../lib/plan-features-storage");
  const { PRODUCT_ENTRIES } = await import("../../lib/product-values");

  const rows = async <T>(q: ReturnType<typeof sql>) => {
    const r = (await db.execute(q)) as unknown;
    return (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as T[];
  };
  const count = async (q: ReturnType<typeof sql>) => Number((await rows<{ n: number }>(q))[0].n);
  const as = (uid: string | null) => {
    g.__campgateSession = uid ? { user: { id: uid, email: `${uid.slice(-4)}@example.test` } } : null;
  };
  const post = async (body: unknown, qs = "") => {
    const res = await notifyRoute.POST(
      new NextRequest(`http://localhost/api/dashboard/products/notify${qs}`, {
        method: "POST",
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" } }),
      }),
    );
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
  };
  const counts = async () => {
    const res = await adminRoute.GET();
    const text = await res.text();
    return { status: res.status, text, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
  };
  const notifyRows = (uid: string) => count(sql`SELECT count(*)::int AS n FROM product_notify_requests WHERE user_id = ${uid}`);

  const MULTI = JSON.stringify({ base: "reception_multi", addons: [] });
  const seeds: Array<[string, string | null]> = [
    [ADMIN, null],
    [TENANT, MULTI],
    [OTHER, MULTI],
    [GF, null],
    [RACE, MULTI],
    [GONE, MULTI],
  ];
  const paidUntil = new Date(Date.now() + 10 * 86400_000).toISOString();
  for (const [uid, products] of seeds) {
    await db.execute(sql`INSERT INTO users (id, email, password_hash, role, subscription_plan, subscription_status, subscription_period, paid_until, email_verified, locale, products)
      VALUES (${uid}, ${`${uid.slice(-4)}@notify.example.test`}, 'x', ${uid === ADMIN ? "admin" : "user"}, 'premium', 'active', 'monthly',
              ${paidUntil}, true, 'fr', ${products}::jsonb)`);
  }

  // ── 1. POST: the gate cases, refusals, idempotence ─────────────────────
  as(null);
  assert.equal((await post({ product: "sales" })).status, 401, "signed out → 401");
  as(TENANT);
  assert.equal((await post({ product: "sales" }, `?asUserId=${OTHER}`)).status, 403, "a non-admin with a foreign asUserId → 403");
  assert.equal(await notifyRows(OTHER), 0, "the 403 wrote nothing");
  for (const bad of [{ product: "gold" }, { product: "reception_multi" }, { product: "Sales" }, {}, { product: null }, { product: ["sales"] }, null, "{not json"]) {
    const r = await post(bad);
    assert.deepEqual([r.status, r.body], [400, { error: "invalid_product" }], `invalid ${JSON.stringify(bad)} → 400`);
  }
  const owned = await post({ product: "reception" });
  assert.deepEqual([owned.status, owned.body], [409, { error: "product_owned" }], "an entitled entry → 409");
  assert.equal(await notifyRows(TENANT), 0, "no refusal wrote a row");

  const before = Date.now();
  const first = await post({ product: "sales" });
  assert.equal(first.status, 201, "tenant → 201");
  assert.deepEqual(Object.keys(first.body!), ["product", "requestedAt"], "no message string");
  assert.equal(first.body!.product, "sales");
  const at = Date.parse(String(first.body!.requestedAt));
  assert.ok(at >= before - 1000 && at <= Date.now() + 1000, "requestedAt is now");
  const again = await post({ product: "sales" });
  assert.deepEqual([again.status, again.body], [200, first.body], "a repeat → 200 with the original requestedAt");
  assert.equal(await notifyRows(TENANT), 1);

  as(ADMIN);
  const a = await post({ product: "connect" }, `?asUserId=${OTHER}`);
  assert.equal(a.status, 201, "admin via asUserId → 201");
  assert.equal(a.body!.product, "connect");
  assert.equal(await notifyRows(OTHER), 1);
  assert.equal(await notifyRows(ADMIN), 0, "the admin's own account untouched");
  // The regression: grandfathered premium is ENTITLED to sales, but dispatch is
  // off, so the menu shows sales as a "soon" preview → accepted, not 409.
  assert.ok((await accountProducts(GF)).entries.includes("sales"), "GF is entitled to sales");
  const gfSoon = await post({ product: "sales" }, `?asUserId=${GF}`);
  assert.equal(gfSoon.status, 201, "entitled + gate off (dispatch off) → 201");
  const gfOwned = await post({ product: "reception" }, `?asUserId=${GF}`);
  assert.deepEqual([gfOwned.status, gfOwned.body], [409, { error: "product_owned" }], "entitled + gate on (reception) → 409");
  assert.equal((await post({ product: "sales" }, `?asUserId=${id(0xfff)}`)).status, 404, "unknown account → 404");
  assert.equal(await count(sql`SELECT count(*)::int AS n FROM product_notify_requests WHERE user_id NOT IN (${TENANT}, ${OTHER}, ${GF})`), 0);
  console.log("ok: POST notify — 401 / tenant 201 / repeat 200 same requestedAt / admin asUserId 201 / foreign 403 / invalid 400 / owned 409 / entitled+gate off 201");

  // ── 2. Concurrency: exactly one row, one requestedAt ───────────────────
  as(RACE);
  const results = await Promise.all(Array.from({ length: 10 }, () => post({ product: "connect" })));
  for (const r of results) assert.ok(r.status === 201 || r.status === 200, `status ${r.status}`);
  assert.equal(results.filter((r) => r.status === 201).length, 1, "exactly one 201");
  assert.equal(new Set(results.map((r) => r.body?.requestedAt)).size, 1, "every answer carries the same requestedAt");
  assert.equal(await notifyRows(RACE), 1, "exactly one row");
  await assert.rejects(
    db.execute(sql`INSERT INTO product_notify_requests (user_id, product) VALUES (${RACE}, 'connect')`),
    (e: unknown) => /product_notify_requests_once/.test(String((e as { cause?: { message?: string } }).cause?.message ?? e)),
  );
  await assert.rejects(
    db.execute(sql`INSERT INTO product_notify_requests (user_id, product) VALUES (${RACE}, 'reception_multi')`),
    (e: unknown) => /product_notify_requests_product_check/.test(String((e as { cause?: { message?: string } }).cause?.message ?? e)),
  );
  console.log("ok: 10 concurrent POSTs → 1 row, one 201, one requestedAt; unique + CHECK in the database");

  // ── 3. accountProducts.notifyRequested (additive, ordered) ─────────────
  {
    as(TENANT);
    assert.equal((await post({ product: "connect" })).status, 201);
    const t = await accountProducts(TENANT);
    assert.deepEqual(Object.keys(t), ["base", "addons", "entries", "source", "trials", "notifyRequested"]);
    assert.deepEqual(t.notifyRequested, ["sales", "connect"], "PRODUCT_ENTRIES order");
    assert.deepEqual([t.base, t.addons, t.entries, t.source], ["reception_multi", [], ["reception"], "products"], "entitlement unchanged");
    assert.deepEqual((await accountProducts(OTHER)).notifyRequested, ["connect"]);
    assert.deepEqual((await accountProducts(GF)).notifyRequested, ["sales"], "the entitled-but-gated request was recorded");
    assert.deepEqual((await accountProducts(id(0xfff))).notifyRequested, [], "unknown account");
  }
  console.log("ok: accountProducts.notifyRequested");

  // ── 4. Admin counts: gated, counts only ────────────────────────────────
  as(null);
  assert.equal((await counts()).status, 401, "admin counts signed out → 401");
  as(TENANT);
  assert.equal((await counts()).status, 403, "admin counts as a tenant → 403");
  as(ADMIN);
  const c = await counts();
  assert.equal(c.status, 200);
  assert.deepEqual(c.body, { counts: { reception: 0, sales: 2, connect: 3 } });
  assert.ok(!/@|[0-9a-f]{8}-[0-9a-f]{4}-|example\.test/i.test(c.text), "no email, no id in the response");
  console.log("ok: GET /api/admin/product-notify — counts only, 401 / 403 / 200");

  // ── 5. FK cascade on user delete ───────────────────────────────────────
  as(GONE);
  assert.equal((await post({ product: "sales" })).status, 201);
  assert.equal(await notifyRows(GONE), 1);
  await db.execute(sql`DELETE FROM users WHERE id = ${GONE}`);
  assert.equal(await notifyRows(GONE), 0, "the rows go with the account");
  console.log("ok: ON DELETE CASCADE");

  // ── 6. A record only: no mail / message code on the path ───────────────
  for (const f of ["app/api/dashboard/products/notify/route.ts", "app/api/admin/product-notify/route.ts", "lib/product-notify.ts"]) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    const imports = src.match(/^import[\s\S]*?;/gm) ?? [];
    assert.ok(imports.length > 0, `${f} has imports`);
    for (const i of imports) assert.ok(!/mail|resend|whatsapp|twilio|alert|notif(y|ication)-send/i.test(i), `${f} imports nothing that sends: ${i}`);
    assert.ok(!/sendEmail|sendMail|alertAdmins|fetch\(/.test(src), `${f} calls nothing that sends`);
  }
  console.log("ok: no email is sent (source guard)");

  // ── 7. The menu rule: 409 only for what the menu shows as owned ────────
  {
    const setEnv = (v: { CAMPAIGN_DISPATCH?: string; CLIENT_AGENT?: string }) => {
      delete process.env.CAMPAIGN_DISPATCH;
      delete process.env.CLIENT_AGENT;
      if (v.CAMPAIGN_DISPATCH) process.env.CAMPAIGN_DISPATCH = v.CAMPAIGN_DISPATCH;
      if (v.CLIENT_AGENT) process.env.CLIENT_AGENT = v.CLIENT_AGENT;
    };
    // Non-empty subsets only: a users.products record always has a base (no
    // record = the grandfathered rules, which entitle reception + sales).
    const SUBSETS = Array.from({ length: (1 << PRODUCT_ENTRIES.length) - 1 }, (_, m) => m + 1);
    const entriesOf = (m: number) => PRODUCT_ENTRIES.filter((_, j) => (m >> j) & 1);
    for (const m of SUBSETS) {
      const e = entriesOf(m);
      const rec = JSON.stringify({ base: e[0], addons: e.slice(1) });
      await db.execute(sql`INSERT INTO users (id, email, password_hash, role, subscription_plan, subscription_status, subscription_period, paid_until, email_verified, locale, products)
        VALUES (${SUBSET(m)}, ${`s${m}@notify.example.test`}, 'x', 'user', 'premium', 'active', 'monthly', ${paidUntil}, true, 'fr', ${rec}::jsonb)`);
    }
    const CONNECT_ONLY = SUBSET(1 << PRODUCT_ENTRIES.indexOf("connect"));
    const NONE = SUBSET(1 << PRODUCT_ENTRIES.indexOf("reception")); // not entitled to connect
    const reset = () => db.execute(sql`DELETE FROM product_notify_requests WHERE user_id::text LIKE '00000000-0000-4000-8000-0000000001%'`);

    // The four cases on connect (the gate CLIENT_AGENT drives for a tenant).
    as(CONNECT_ONLY);
    setEnv({});
    assert.deepEqual((await accountProducts(CONNECT_ONLY)).entries, ["connect"]);
    assert.deepEqual((await accountProducts(NONE)).entries, ["reception"]);
    assert.equal((await post({ product: "connect" })).status, 201, "entitled + gate off → 201");
    await reset();
    setEnv({ CLIENT_AGENT: "all" });
    assert.deepEqual((await post({ product: "connect" })).body, { error: "product_owned" }, "entitled + gate on → 409");
    as(NONE);
    setEnv({});
    assert.equal((await post({ product: "connect" })).status, 201, "not entitled + gate off → 201");
    await reset();
    setEnv({ CLIENT_AGENT: "all" });
    assert.equal((await post({ product: "connect" })).status, 201, "not entitled + gate on → 201 (a try preview)");
    await reset();

    // Admin via ?asUserId: the TARGET's role decides the gate, as in the admin
    // layout (= what the tenant sees). CLIENT_AGENT=admin turns connect on for
    // admin accounts only: the target is a tenant, so connect is "soon" → 201.
    as(ADMIN);
    setEnv({ CLIENT_AGENT: "admin" });
    assert.equal((await post({ product: "connect" }, `?asUserId=${CONNECT_ONLY}`)).status, 201, "admin asUserId: the target's gate (off), not the admin's");
    await reset();
    setEnv({ CLIENT_AGENT: "all" });
    assert.equal((await post({ product: "connect" }, `?asUserId=${CONNECT_ONLY}`)).status, 409, "admin asUserId: entitled + gate on → 409");
    setEnv({});
    assert.equal((await post({ product: "sales" })).status, 409, "an admin account's own menu owns everything");
    assert.equal(await notifyRows(ADMIN), 0);

    // Agreement: every account × env × entry, the route vs menuFor (the same
    // inputs the layouts pass: own role, featuresForPlan of the stored matrix).
    const ENVS = [{}, { CAMPAIGN_DISPATCH: "on" }, { CLIENT_AGENT: "admin" }, { CLIENT_AGENT: "all" }, { CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" }];
    const features = featuresForPlan(await getPlanFeatureMatrix(), "premium");
    let checked = 0;
    for (const env of ENVS) {
      setEnv(env);
      for (const m of SUBSETS) {
        await reset();
        const uid = SUBSET(m);
        const menu = menuFor(await accountProducts(uid), "user", features, process.env);
        for (const entry of PRODUCT_ENTRIES) {
          for (const viaAdmin of [false, true]) {
            await reset();
            as(viaAdmin ? ADMIN : uid);
            const r = await post({ product: entry }, viaAdmin ? `?asUserId=${uid}` : "");
            const want = menu[entry].state === "owned" ? 409 : 201;
            assert.equal(r.status, want, `${JSON.stringify(env)} ${entriesOf(m).join("+")} ${entry} admin=${viaAdmin}: route ${r.status}, menu ${menu[entry].state}`);
            checked++;
          }
        }
      }
    }
    setEnv({});
    await reset();
    await db.execute(sql`DELETE FROM users WHERE id::text LIKE '00000000-0000-4000-8000-0000000001%'`);
    console.log(`ok: 409 only when the menu shows owned — 4 cases, admin target, ${checked} route × menuFor agreements`);
  }

  console.log("ALL PRODUCT-NOTIFY DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
