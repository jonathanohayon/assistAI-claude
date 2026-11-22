// HYP multi-line orders (P4) against a THROWAWAY Postgres, through the real
// routes, with a fake HYP (fixtures/hyp-orders/mock-hyp.ts: globalThis.fetch
// answers ONLY the mock host, anything else throws) and a recording email
// double (no email is ever sent):
//   1. LEGACY byte-identity: the `{ plan, period, locale }` body, end to end
//      (SIGN request, order row, callback DB effects, events, email, replay,
//      billing-stats) is identical to the recorded fixture
//      fixtures/hyp-orders/legacy-capture.json, under EVERY PRODUCT_ORDERS mode;
//   1b. PRODUCT_ORDERS (off by default): off refuses every products body
//      (400 product_orders_disabled) for tenant and admin with HYP
//      unreachable (never invoked), nothing written, no event; admin lets
//      only an admin account through; a products order paid after the switch
//      went back to off is activated normally;
//   2. the products body: refusals (4xx, nothing written; a sales / connect
//      BASE refused even with every flag on), a client amount ignored, the
//      lines + sum + SIGN params, add-ons behind their flags;
//   3. the callback: an amount ≠ the sum is rejected as today; a paid order
//      sets users.products / plan / period / paidUntil / trial cleared and
//      the base line's period; the email lists the lines; a replay does nothing;
//   4. billing-stats: `lines` on a multi-line invoice row only;
//   5. overage: added as a line for a record holder, priced from the
//      account's calls; a failed order does not count as billed; two
//      checkouts both carry it, two concurrent callbacks record it ONCE (the
//      other is refused + an admin alert); the next checkout no longer
//      carries it; a grandfathered account never gets one;
//   6. terms snapshot: `preview: true` writes nothing and never calls HYP;
//      a paid order's lines carry their terms; a catalogue edit AFTER the
//      payment changes nothing for that period (billing-stats usageByProduct,
//      the usage warning thresholds) and shows in the next checkout's
//      `changes`; a finished period's overage is billed at ITS pinned terms;
//   7. currency lock: overage pending from a EUR-paid period → an ILS order
//      (and its preview) is refused 409 overage_currency_pending { currency:
//      EUR, amount }, nothing written, HYP never called; PRODUCT_ORDERS off
//      still refuses first; the same currency carries the overage at the
//      pinned rate; no pending overage → a currency switch is allowed.
// Plain `npm test` skips it. Run it with:  bash scripts/hyp-orders-db.sh
// ORDERS_RECORD=<file> writes the legacy capture instead (used once to
// record the fixture from the tree before P4, see the PR).

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const url = process.env.ORDERS_DB_TEST_URL;
if (!url) {
  console.log("skip: HYP orders DB part (no ORDERS_DB_TEST_URL — see scripts/hyp-orders-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /HYP|^(LIVEKIT|TWILIO|RESEND|WHATSAPP|GOOGLE)|OPENAI|REALTIME_API_KEY|EMAIL_FROM|ADMIN_ALERT|CAMPAIGN_DISPATCH|CLIENT_AGENT|PRODUCT_ORDERS|APP_URL/i.test(k))) {
  throw new Error("refusing to run with provider env, HYP env or product flags set");
}
if (!(globalThis as { __hypOrdersHooks?: boolean }).__hypOrdersHooks) throw new Error("module hooks missing: run through scripts/hyp-orders-db.sh");
process.env.DATABASE_URL = url;
// Mock credentials only (fake masof id); the host is the mock one.
process.env.HYP_TERMINAL = "0000000001";
process.env.HYP_PASSP = "mock-passp";
process.env.HYP_KEY = "mock-key";
process.env.APP_URL = "http://app.example.test";
process.env.RESEND_API_KEY = "mock-resend-key";
process.env.ADMIN_ALERT_EMAIL = "alerts@example.test";

type Sent = { to: string[]; subject: string; text: string; html: string };
const g = globalThis as { __campgateSession?: { user: { id: string } } | null; __sentEmails?: Sent[] };
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const R1 = id(0xd1); // record holder (sign-up record), trialing
const RACE = id(0xd2); // record holder with a past paid coverage + usage
const GF = id(0xd3); // grandfathered (products NULL) with a paid multi-line row + usage
const LEG = id(0xd4); // record holder whose only paid order is legacy
const ADM = id(0xd5); // an account with role admin, trialing
const TRM = id(0xd6); // record holder: terms snapshot, current paid period
const TRM2 = id(0xd7); // record holder: terms snapshot, finished paid period + usage
const FX = id(0xd8); // record holder: EUR-paid finished period + overage pending
const FX2 = id(0xd9); // record holder: EUR-paid finished period, no overage

async function main() {
  const mock = await import("./fixtures/hyp-orders/mock-hyp");
  process.env.HYP_API_URL = mock.MOCK_HYP_URL;
  mock.installMockHyp();
  const { captureLegacy } = await import("./fixtures/hyp-orders/legacy-capture");

  // ── 1. Legacy byte-identity ─────────────────────────────────────────
  const capture = await captureLegacy();
  const text = JSON.stringify(capture, null, 2) + "\n";
  if (process.env.ORDERS_RECORD) {
    writeFileSync(process.env.ORDERS_RECORD, text);
    console.log(`recorded the legacy capture → ${process.env.ORDERS_RECORD}`);
    process.exit(0);
  }
  const fixture = readFileSync(new URL("./fixtures/hyp-orders/legacy-capture.json", import.meta.url), "utf8");
  assert.equal(text, fixture, "the legacy payment differs from the recorded fixture (PRODUCT_ORDERS unset)");
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../../lib/db");
  // The same capture under every other mode: the switch never touches the
  // legacy body. The capture's own rows are removed first (fixed ids).
  const { LEGACY_CASES } = await import("./fixtures/hyp-orders/legacy-capture");
  const dropLegacyRows = async () => {
    for (const c of LEGACY_CASES) {
      await db.execute(sql`DELETE FROM events WHERE user_id = ${c.user}`);
      await db.execute(sql`DELETE FROM payment_orders WHERE user_id = ${c.user}`);
      await db.execute(sql`DELETE FROM users WHERE id = ${c.user}`);
    }
  };
  for (const mode of ["off", "admin", "on", "garbage"]) {
    await dropLegacyRows();
    process.env.PRODUCT_ORDERS = mode;
    const again = JSON.stringify(await captureLegacy(), null, 2) + "\n";
    delete process.env.PRODUCT_ORDERS;
    assert.equal(again, fixture, `the legacy payment differs from the recorded fixture (PRODUCT_ORDERS=${mode})`);
  }
  // Sanity on what the fixture pins: no lines anywhere on a legacy order.
  for (const [k, v] of Object.entries(capture)) {
    const c = v as { signRequests: Array<Record<string, string>>; billingStats: { body: { payments: Array<Record<string, unknown>> } }; emails: unknown[] };
    assert.equal(c.signRequests.length, 1, k);
    assert.equal(c.emails.length, 1, k);
    assert.equal(c.billingStats.body.payments.length, 1, k);
    assert.ok(!("lines" in c.billingStats.body.payments[0]), k);
  }
  const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => {
    const r = (await db.execute(q)) as unknown;
    return (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as T[];
  };
  const legacyProducts = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM payment_orders WHERE products IS NOT NULL`);
  assert.equal(legacyProducts[0].n, 0, "a legacy order wrote payment_orders.products");
  console.log(`  ✓ legacy: ${Object.keys(capture).length} cases identical to the recorded fixture (SIGN, order row, callback effects, events, email, replay, billing-stats), PRODUCT_ORDERS unset/off/admin/on/garbage`);

  // ── Seeds ───────────────────────────────────────────────────────────
  const { NextRequest } = await import("next/server");
  const create = await import("../../app/api/dashboard/hyp/create-payment/route");
  const callback = await import("../../app/api/dashboard/hyp/callback/route");
  const stats = await import("../../app/api/dashboard/billing-stats/route");
  const { addPeriod } = await import("../../lib/billing-activation");

  const REC = JSON.stringify({ base: "reception_multi", addons: [] });
  for (const [uid, products, status, plan] of [
    [R1, REC, "trialing", "essential"],
    [RACE, JSON.stringify({ base: "reception", addons: [] }), "active", "global"],
    [GF, null, "active", "global"],
    [LEG, REC, "active", "premium"],
    [ADM, null, "trialing", "essential"],
  ] as const) {
    await db.execute(sql`INSERT INTO users (id, email, password_hash, display_name, locale, subscription_status, subscription_plan, trial_ends_at, products)
      VALUES (${uid}, ${`${uid.slice(-4)}@example.test`}, 'x', 'Exemple Test', 'fr', ${status}, ${plan}, now() + interval '1 day', ${products}::jsonb)`);
  }
  const as = (uid: string | null) => {
    g.__campgateSession = uid ? { user: { id: uid } } : null;
  };
  const post = async (body: unknown) => {
    const res = await create.POST(
      new NextRequest("http://localhost/api/dashboard/hyp/create-payment", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const orders = (uid: string) =>
    rows<{ id: string; plan_key: string; period: string; expected_amount: number; coin: string; currency: string; status: string; products: unknown; paid_at: string | null }>(
      sql`SELECT id, plan_key, period, expected_amount, coin, currency, status, products, paid_at FROM payment_orders WHERE user_id = ${uid} ORDER BY created_at`,
    );
  const userRow = async (uid: string) =>
    (
      await rows<Record<string, unknown>>(
        sql`SELECT subscription_status, subscription_plan, subscription_period, paid_until, trial_ends_at, products, card_last4, xmin::text AS xmin FROM users WHERE id = ${uid}`,
      )
    )[0];
  const lastSign = () => [...mock.hypRequests].reverse().find((r) => r.what === "SIGN")!.params;
  const pay = async (orderId: string, amount: string, coin: string, locale = "fr") => {
    mock.verifyAnswers[orderId] = { CCode: "0", Id: `mock-txn-${orderId.slice(0, 8)}`, Order: orderId, Amount: amount, Coin: coin, L4digit: "4242", Brand: "2" };
    const res = await callback.GET(new NextRequest(`http://localhost/api/dashboard/hyp/callback?locale=${locale}&Order=${orderId}&Id=mock&CCode=0&Amount=${amount}&Sign=mock`));
    return { status: res.status, body: await res.text() };
  };
  const sent = () => g.__sentEmails ?? [];
  await db.execute(sql`UPDATE users SET role = 'admin' WHERE id = ${ADM}`);

  // ── 1b. PRODUCT_ORDERS ──────────────────────────────────────────────
  const productBody = { products: { base: "reception", addons: [] }, period: "monthly", locale: "fr" };
  const disabled = { status: 400, body: { error: "product_orders_disabled" } };
  const mockFetch = globalThis.fetch;
  let unreachableCalls = 0;
  const hypUnreachable = () => {
    globalThis.fetch = (async () => {
      unreachableCalls++;
      throw new Error("HYP unreachable in this test");
    }) as typeof fetch;
  };
  const eventsOf = async (uid: string) => (await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM events WHERE user_id = ${uid}`))[0].n;
  const xminOf = async (uid: string) => (await userRow(uid)).xmin;
  const gateBodies: unknown[] = [
    productBody,
    { ...productBody, products: { base: "reception_multi", addons: ["reception"] } },
    { products: { base: "nope" }, plan: "global", period: "weekly" },
    { products: null },
  ];
  const xminBefore = { R1: await xminOf(R1), ADM: await xminOf(ADM) };
  // off (unset and any unknown value) and admin-for-a-tenant: refused first.
  hypUnreachable();
  let gateCases = 0;
  for (const [mode, uids] of [
    [undefined, [R1, ADM]],
    ["off", [R1, ADM]],
    ["yes", [R1, ADM]],
    ["admin", [R1]],
  ] as const) {
    if (mode === undefined) delete process.env.PRODUCT_ORDERS;
    else process.env.PRODUCT_ORDERS = mode;
    for (const uid of uids) {
      as(uid);
      for (const b of gateBodies) {
        assert.deepEqual(await post(b), disabled, `PRODUCT_ORDERS=${mode} ${uid === ADM ? "admin" : "tenant"} ${JSON.stringify(b)}`);
        gateCases++;
      }
    }
  }
  delete process.env.PRODUCT_ORDERS;
  globalThis.fetch = mockFetch;
  assert.equal(unreachableCalls, 0, "a refused products body invoked fetch (HYP)");
  assert.equal((await orders(R1)).length + (await orders(ADM)).length, 0, "a refused products body wrote an order");
  assert.equal((await eventsOf(R1)) + (await eventsOf(ADM)), 0, "a refused products body wrote an event");
  assert.deepEqual({ R1: await xminOf(R1), ADM: await xminOf(ADM) }, xminBefore, "a refused products body touched the user row");
  // admin: the admin account goes through (and only it).
  process.env.PRODUCT_ORDERS = "admin";
  as(ADM);
  const adm = await post(productBody);
  assert.equal(adm.status, 200, JSON.stringify(adm.body));
  assert.deepEqual(adm.body.lines, [{ kind: "base", product: "reception", period: "monthly", amount: 89 }]);
  // Paid AFTER the switch went back to off: activated normally.
  delete process.env.PRODUCT_ORDERS;
  const [admOrder] = await orders(ADM);
  assert.equal(admOrder.status, "pending");
  const admMails = sent().length;
  const admPaid = await pay(admOrder.id, "89.00", "3");
  assert.ok(admPaid.body.includes("paid=1"), admPaid.body);
  assert.equal((await orders(ADM))[0].status, "paid");
  const admUser = await userRow(ADM);
  assert.deepEqual(
    { s: admUser.subscription_status, plan: admUser.subscription_plan, products: admUser.products, trial: admUser.trial_ends_at },
    { s: "active", plan: "global", products: { base: "reception", addons: [] }, trial: null },
  );
  assert.equal(sent().length, admMails + 1, "the paying customer got no confirmation email");
  // on: every account (the tenant below, and the admin).
  process.env.PRODUCT_ORDERS = "on";
  as(ADM);
  assert.equal((await post(productBody)).status, 200);
  assert.equal((await orders(ADM)).length, 2);
  console.log(`  ✓ PRODUCT_ORDERS: ${gateCases} refusals (unset/off/unknown × tenant+admin, admin × tenant) with HYP unreachable: fetch never invoked, no order, no event, user untouched; admin → admin only; a products order paid after the switch went off is activated; on → everyone`);

  // ── 2. The products body: refusals ──────────────────────────────────
  as(null);
  assert.equal((await post({ products: { base: "reception", addons: [] }, period: "monthly", locale: "fr" })).status, 401);
  as(R1);
  const refusals: Array<[unknown, number, string, Record<string, string>?]> = [
    [{ products: { base: "nope", addons: [] }, period: "monthly" }, 400, "unknown_product"],
    [{ products: { base: "reception", addons: ["sms"] }, period: "monthly" }, 400, "unknown_product"],
    [{ products: { base: "reception", addons: ["sales", "sales"] }, period: "monthly" }, 400, "duplicate_addon", { CAMPAIGN_DISPATCH: "on" }],
    [{ products: { base: "reception", addons: ["reception"] }, period: "monthly" }, 400, "base_in_addons"],
    [{ products: { base: "reception", addons: ["reception_multi"] }, period: "monthly" }, 400, "addon_not_sold"],
    [{ products: { base: "reception_multi", addons: ["reception"] }, period: "monthly" }, 400, "addon_same_family"],
    [{ products: { base: "reception" }, period: "monthly" }, 400, "invalid_products"],
    [{ products: { base: "reception", addons: [] }, period: "weekly" }, 400, "invalid period"],
    [{ products: { base: "reception", addons: [] }, plan: "global", period: "monthly" }, 400, "ambiguous_body"],
    [{ products: { base: "reception", addons: ["sales"] }, period: "monthly" }, 409, "product_unavailable"],
    [{ products: { base: "reception", addons: ["connect"] }, period: "monthly" }, 409, "product_unavailable", { CLIENT_AGENT: "admin" }],
    // A sales / connect BASE: refused even with every flag on.
    [{ products: { base: "sales", addons: [] }, period: "monthly" }, 409, "product_unavailable", { CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" }],
    [{ products: { base: "connect", addons: [] }, period: "monthly" }, 409, "product_unavailable", { CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" }],
  ];
  const signsBefore = mock.hypRequests.length;
  for (const [body, status, error, env] of refusals) {
    for (const [k, v] of Object.entries(env ?? {})) process.env[k] = v;
    const r = await post(body);
    for (const k of Object.keys(env ?? {})) delete process.env[k];
    assert.deepEqual(r, { status, body: { error } }, JSON.stringify(body));
  }
  assert.equal((await orders(R1)).length, 0, "a refused body wrote an order");
  assert.equal(mock.hypRequests.length, signsBefore, "a refused body reached HYP");
  console.log(`  ✓ products body: ${refusals.length + 1} refusals (401/400/409), nothing written, HYP never called`);

  // ── 2b. Accepted: the client's amount and lines are ignored ────────
  const a = await post({
    products: { base: "reception", addons: [] },
    period: "monthly",
    locale: "fr",
    amount: 0.01,
    expectedAmount: 0.01,
    lines: [{ kind: "base", product: "reception", period: "monthly", amount: 0.01 }],
  });
  assert.equal(a.status, 200);
  const baseLine = { kind: "base", product: "reception", period: "monthly", amount: 89 };
  const baseTerms = { price: 89, includedMinutes: 200, overageRate: 0.39, currency: "EUR" };
  // P4's fields unchanged (`lines` without terms), plus `terms` and `changes` (a first order: none).
  assert.deepEqual(
    { ...a.body, url: undefined },
    { url: undefined, amount: 89, currency: "EUR", lines: [baseLine], terms: [{ kind: "base", product: "reception", ...baseTerms }], changes: [] },
  );
  assert.deepEqual(Object.keys(a.body), ["url", "amount", "currency", "lines", "terms", "changes"]);
  assert.ok(String(a.body.url).startsWith(mock.MOCK_HYP_URL));
  let sign = lastSign();
  const [o1] = await orders(R1);
  assert.deepEqual(
    { Amount: sign.Amount, Coin: sign.Coin, Info: sign.Info, Order: sign.Order, PageLang: sign.PageLang, Masof: sign.Masof, tmp: sign.tmp, HK: sign.HK },
    { Amount: "89.00", Coin: "3", Info: "Réceptionniste (mensuel)", Order: o1.id, PageLang: "ENG", Masof: "0000000001", tmp: "3", HK: undefined },
  );
  assert.deepEqual(
    { plan_key: o1.plan_key, period: o1.period, expected_amount: o1.expected_amount, currency: o1.currency, coin: o1.coin, status: o1.status, products: o1.products },
    { plan_key: "global", period: "monthly", expected_amount: 89, currency: "EUR", coin: "3", status: "pending", products: [{ ...baseLine, terms: baseTerms }] },
  );
  // Add-ons once their flags are on; ILS from the he locale; annual = 10x.
  process.env.CAMPAIGN_DISPATCH = "on";
  process.env.CLIENT_AGENT = "all";
  const b = await post({ products: { base: "reception_multi", addons: ["sales", "connect"] }, period: "annual", locale: "he" });
  delete process.env.CAMPAIGN_DISPATCH;
  delete process.env.CLIENT_AGENT;
  assert.equal(b.status, 200);
  assert.equal(b.body.amount, 6490 + 3990 + 1490);
  assert.equal(b.body.currency, "ILS");
  sign = lastSign();
  assert.equal(sign.Amount, "11970.00");
  assert.equal(sign.Coin, "1");
  assert.equal(sign.PageLang, "HEB");
  assert.equal(sign.Info, "Clinique / Multi-sites +2 תוספות (שנתי)".replace("Clinique / Multi-sites", (await import("../../messages/he.json")).default.Plans.premium.name));
  const o2 = (await orders(R1))[1];
  assert.equal(o2.plan_key, "premium");
  assert.equal(o2.expected_amount, 11970);
  console.log("  ✓ products body: server-computed lines + sum, client amount ignored, SIGN Amount/Coin/Info/PageLang, add-ons behind flags");

  // ── 3. Callback ─────────────────────────────────────────────────────
  const before = await userRow(R1);
  const bad = await pay(o2.id, "89.00", "1", "he");
  assert.ok(bad.body.includes("payment=failed"));
  assert.equal((await orders(R1))[1].status, "failed");
  assert.equal((await userRow(R1)).xmin, before.xmin, "an amount mismatch touched the user");
  const mailsBefore = sent().length;
  const ok1 = await pay(o1.id, "89.00", "3");
  assert.ok(ok1.body.includes("paid=1"), ok1.body);
  const u1 = await userRow(R1);
  const [p1] = await orders(R1);
  assert.equal(p1.status, "paid");
  assert.deepEqual(
    { s: u1.subscription_status, plan: u1.subscription_plan, period: u1.subscription_period, trial: u1.trial_ends_at, products: u1.products, card: u1.card_last4 },
    { s: "active", plan: "global", period: "monthly", trial: null, products: { base: "reception", addons: [] }, card: "4242" },
  );
  const paidAt1 = new Date(String(p1.paid_at));
  const paidUntil1 = new Date(String(u1.paid_until));
  assert.equal(paidUntil1.getTime(), addPeriod(paidAt1, "monthly").getTime());
  const paidLines = p1.products as Array<Record<string, unknown>>;
  assert.deepEqual(paidLines, [{ ...baseLine, terms: baseTerms, periodStart: paidAt1.toISOString(), periodEnd: paidUntil1.toISOString() }]);
  const mail = sent().slice(mailsBefore);
  assert.equal(mail.length, 1);
  assert.deepEqual(mail[0].to, [`${R1.slice(-4)}@example.test`]);
  assert.ok(mail[0].text.includes("Réceptionniste — 89 €"), mail[0].text);
  // Replay: nothing new.
  const replay = await pay(o1.id, "89.00", "3");
  assert.ok(replay.body.includes("paid=1"));
  assert.equal((await userRow(R1)).xmin, u1.xmin);
  assert.equal(sent().length, mailsBefore + 1);
  console.log("  ✓ callback: mismatch rejected (user untouched), paid → users.products/plan/period/paidUntil/trial cleared + base line period, email lists the lines, replay no-op");

  // ── 4. billing-stats ────────────────────────────────────────────────
  const st = await stats.GET(new NextRequest("http://localhost/api/dashboard/billing-stats"));
  const sb = (await st.json()) as { payments: Array<Record<string, unknown>> };
  assert.equal(sb.payments.length, 1);
  // The invoice row's `lines` keep P4's shape (the terms snapshot is not shown).
  assert.deepEqual(sb.payments[0].lines, [{ ...baseLine, periodStart: paidAt1.toISOString(), periodEnd: paidUntil1.toISOString() }]);
  console.log("  ✓ billing-stats: the multi-line invoice row carries `lines` (P4 shape, no terms)");

  // ── 5. Overage ──────────────────────────────────────────────────────
  // A past paid coverage for RACE: [now - 31 days, now - 1 day), base
  // reception (200 min included), 250 min of reception calls inside it.
  const T1 = new Date(Date.now() - 24 * 3600 * 1000);
  const T0 = new Date(T1.getTime() - 30 * 24 * 3600 * 1000);
  const cov = (uid: string, status: string, extra: unknown[] = []) =>
    db.execute(sql`INSERT INTO payment_orders (user_id, plan_key, period, currency, coin, expected_amount, status, expires_at, paid_at, products)
      VALUES (${uid}, 'global', 'monthly', 'EUR', '3', 89, ${status}, ${T0.toISOString()}, ${status === "paid" ? T0.toISOString() : null},
      ${JSON.stringify([{ kind: "base", product: "reception", period: "monthly", amount: 89, periodStart: T0.toISOString(), periodEnd: T1.toISOString() }, ...extra])}::jsonb)`);
  const usage = (uid: string, minutes: number, at: Date) =>
    db.execute(sql`INSERT INTO calls (user_id, from_number, to_number, duration_seconds, created_at) VALUES (${uid}, '+15550000301', '+15550000302', ${minutes * 60}, ${at.toISOString()})`);
  const mid = new Date(T0.getTime() + 10 * 24 * 3600 * 1000);
  await cov(RACE, "paid");
  await usage(RACE, 250, mid);
  // A FAILED order carrying that overage does not count as billed.
  await db.execute(sql`INSERT INTO payment_orders (user_id, plan_key, period, currency, coin, expected_amount, status, expires_at, products)
    VALUES (${RACE}, 'global', 'monthly', 'EUR', '3', 108.5, 'failed', ${T1.toISOString()},
    ${JSON.stringify([baseLine, { kind: "overage", entry: "reception", periodStart: T0.toISOString(), periodEnd: T1.toISOString(), minutes: 50, amount: 19.5 }])}::jsonb)`);
  as(RACE);
  const body = { products: { base: "reception", addons: [] }, period: "monthly", locale: "fr" };
  // Two checkouts side by side: pending orders reserve nothing, both carry it.
  const [c1, c2] = await Promise.all([post(body), post(body)]);
  const overage = { kind: "overage", entry: "reception", periodStart: T0.toISOString(), periodEnd: T1.toISOString(), minutes: 50, amount: 19.5 };
  for (const c of [c1, c2]) {
    assert.equal(c.status, 200);
    assert.deepEqual(c.body.lines, [baseLine, overage]);
    assert.equal(c.body.amount, 108.5);
  }
  sign = lastSign();
  assert.equal(sign.Amount, "108.50");
  assert.equal(sign.Info, "Réceptionniste + dépassement (mensuel)");
  const pend = (await orders(RACE)).filter((o) => o.status === "pending");
  assert.equal(pend.length, 2);
  // Two concurrent successful callbacks: the overage is recorded ONCE.
  const mailsRace = sent().length;
  const [r1, r2] = await Promise.all(pend.map((o) => pay(o.id, "108.50", "3")));
  const outcomes = [r1, r2].map((r) => (r.body.includes("paid=1") ? "paid" : "failed")).sort();
  assert.deepEqual(outcomes, ["failed", "paid"]);
  const after = await orders(RACE);
  const paidWithOverage = after.filter((o) => o.status === "paid" && (o.products as Array<{ kind: string }>).some((l) => l.kind === "overage"));
  assert.equal(paidWithOverage.length, 1, "the same overage was recorded as billed twice");
  const rejected = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM events WHERE user_id = ${RACE} AND metadata->>'reason' = 'overage_already_billed'`);
  assert.equal(rejected[0].n, 1);
  const raceMails = sent().slice(mailsRace);
  assert.ok(raceMails.some((m) => m.to.includes("alerts@example.test") && /overage already billed/i.test(m.subject)), "no admin alert for the refund");
  const customer = raceMails.filter((m) => m.to.includes(`${RACE.slice(-4)}@example.test`));
  assert.equal(customer.length, 1);
  assert.ok(customer[0].text.includes("Dépassement Réception — 50 min — 19,50 €"), customer[0].text);
  // The next checkout recomputes: that overage is no longer carried.
  const c3 = await post(body);
  assert.deepEqual(c3.body.lines, [baseLine]);
  console.log("  ✓ overage: priced from calls, failed order ≠ billed, two checkouts both carry it, two concurrent callbacks record it once (+ refund alert), the next checkout drops it");

  // Grandfathered (products NULL): never an overage line, even with a paid
  // multi-line coverage and usage over it.
  await cov(GF, "paid");
  await usage(GF, 900, mid);
  as(GF);
  const gf = await post(body);
  assert.equal(gf.status, 200);
  assert.deepEqual(gf.body.lines, [baseLine]);
  // A record holder whose only paid order is legacy: no coverage, no overage.
  await db.execute(sql`INSERT INTO payment_orders (user_id, plan_key, period, currency, coin, expected_amount, status, expires_at, paid_at)
    VALUES (${LEG}, 'premium', 'monthly', 'EUR', '3', 169, 'paid', ${T0.toISOString()}, ${T0.toISOString()})`);
  await usage(LEG, 900, mid);
  as(LEG);
  const leg = await post({ products: { base: "reception_multi", addons: [] }, period: "monthly", locale: "en" });
  assert.deepEqual(leg.body.lines, [{ kind: "base", product: "reception_multi", period: "monthly", amount: 169 }]);
  assert.equal(lastSign().Info, "Multi-site / Clinic (monthly)".replace("Multi-site / Clinic", (await import("../../messages/en.json")).default.Plans.premium.name));
  console.log("  ✓ overage: never for a grandfathered account, never over a legacy-paid period");

  // ── 6. Terms snapshot ───────────────────────────────────────────────
  {
    const { setProductCatalogue } = await import("../../lib/products");
    const { defaultProductCatalogue } = await import("../../lib/product-catalogue");
    const { runUsageWarnings } = await import("../../lib/usage-warnings");
    const { usageWarningDeps, listWarnableAccounts } = await import("../../lib/usage-warnings-deps");
    for (const uid of [TRM, TRM2]) {
      await db.execute(sql`INSERT INTO users (id, email, password_hash, display_name, locale, subscription_status, subscription_plan, trial_ends_at, products)
        VALUES (${uid}, ${`${uid.slice(-4)}@example.test`}, 'x', 'Exemple Test', 'fr', 'trialing', 'essential', now() + interval '1 day', ${JSON.stringify({ base: "reception", addons: [] })}::jsonb)`);
    }
    // Preview: the same body, nothing created, HYP never called.
    as(TRM);
    const hypBefore = mock.hypRequests.length;
    const xTrm = await xminOf(TRM);
    const pv = await post({ ...body, preview: true });
    assert.equal(pv.status, 200);
    assert.deepEqual(pv.body, {
      amount: 89,
      currency: "EUR",
      lines: [baseLine],
      terms: [{ kind: "base", product: "reception", ...baseTerms }],
      changes: [],
      preview: true,
    });
    assert.deepEqual(await post({ ...body, preview: "yes" }), { status: 400, body: { error: "invalid_preview" } });
    assert.equal(mock.hypRequests.length, hypBefore, "a preview reached HYP");
    assert.equal((await orders(TRM)).length, 0, "a preview wrote an order");
    assert.equal(await eventsOf(TRM), 0, "a preview wrote an event");
    assert.equal(await xminOf(TRM), xTrm, "a preview touched the user row");
    // Off: a preview is refused like any products body.
    delete process.env.PRODUCT_ORDERS;
    assert.deepEqual(await post({ ...body, preview: true }), disabled);
    process.env.PRODUCT_ORDERS = "on";

    // Paid at the default catalogue: the stored lines carry the terms.
    const t1 = await post(body);
    assert.equal(t1.status, 200);
    const [tOrder] = await orders(TRM);
    assert.ok((await pay(tOrder.id, "89.00", "3")).body.includes("paid=1"));
    const tPaid = (await orders(TRM))[0].products as Array<Record<string, unknown>>;
    assert.deepEqual(tPaid[0].terms, baseTerms);

    // 170 min used in the paid period, then the catalogue is edited.
    await usage(TRM, 170, new Date(Date.now() + 60 * 1000));
    const edited = defaultProductCatalogue();
    edited.reception.EUR.monthly = 99;
    edited.reception.EUR.minutes = 100;
    edited.reception.EUR.overagePerMin = 0.99;
    await setProductCatalogue(edited);
    const usageOf = async () => {
      const r = await stats.GET(new NextRequest("http://localhost/api/dashboard/billing-stats"));
      const j = (await r.json()) as { usageByProduct: { entries: Array<Record<string, unknown>> } };
      return j.usageByProduct.entries.find((e) => e.entry === "reception")!;
    };
    const shown = await usageOf();
    assert.deepEqual(
      { used: shown.usedMinutes, included: shown.includedMinutes, rate: shown.overageRate, over: shown.overageMinutes },
      { used: 170, included: 200, rate: 0.39, over: 0 },
      "a catalogue edit after the payment changed that period's displayed numbers",
    );
    // The warnings: 170 of the pinned 200 = 85 % → the 80 % warning only.
    const claims: Array<{ entry: string; threshold: number }> = [];
    const warned: Array<{ included: number; threshold: number; rate: string }> = [];
    const res = await runUsageWarnings(
      usageWarningDeps({
        env: { USAGE_WARNINGS_ENABLED: "1" },
        listAccounts: async () => (await listWarnableAccounts()).filter((x) => x.id === TRM),
        claim: async (c) => {
          claims.push({ entry: c.entry, threshold: c.threshold });
          return true;
        },
        send: async (_to, input) => {
          warned.push({ included: input.includedMinutes, threshold: input.threshold, rate: input.overageRate });
          return { ok: true };
        },
        logEvent: async () => undefined,
      }),
    );
    assert.equal(res.accounts, 1);
    assert.deepEqual(claims, [{ entry: "reception", threshold: 80 }]);
    assert.deepEqual(warned, [{ included: 200, threshold: 80, rate: "0.39 €" }]);

    // The next checkout: the edited catalogue applies, and `changes` says what moved.
    const t2 = await post(body);
    assert.equal(t2.status, 200);
    assert.equal(t2.body.amount, 99);
    assert.deepEqual(t2.body.terms, [{ kind: "base", product: "reception", price: 99, includedMinutes: 100, overageRate: 0.99, currency: "EUR" }]);
    assert.deepEqual(t2.body.changes, [
      { product: "reception", field: "price", from: 89, to: 99 },
      { product: "reception", field: "includedMinutes", from: 200, to: 100 },
      { product: "reception", field: "overageRate", from: 0.39, to: 0.99 },
    ]);
    // Adding an add-on: it shows as added.
    process.env.CAMPAIGN_DISPATCH = "on";
    const t3 = await post({ ...body, products: { base: "reception", addons: ["sales"] }, preview: true });
    delete process.env.CAMPAIGN_DISPATCH;
    assert.deepEqual((t3.body.changes as Array<{ field: string; product: string }>).map((c) => [c.field, c.product]), [
      ["price", "reception"],
      ["includedMinutes", "reception"],
      ["overageRate", "reception"],
      ["added", "sales"],
    ]);

    // A FINISHED period paid at the default terms, 250 min used, the
    // catalogue edited since: billed at THAT period's terms (200 min at
    // 0.39 → 50 × 0.39), never at the edited 100 min × 0.99.
    await db.execute(sql`INSERT INTO payment_orders (user_id, plan_key, period, currency, coin, expected_amount, status, expires_at, paid_at, products)
      VALUES (${TRM2}, 'global', 'monthly', 'EUR', '3', 89, 'paid', ${T0.toISOString()}, ${T0.toISOString()},
      ${JSON.stringify([{ ...baseLine, terms: baseTerms, periodStart: T0.toISOString(), periodEnd: T1.toISOString() }])}::jsonb)`);
    await usage(TRM2, 250, mid);
    as(TRM2);
    const t4 = await post(body);
    assert.equal(t4.status, 200);
    assert.deepEqual(t4.body.lines, [{ ...baseLine, amount: 99 }, overage]);
    assert.equal(t4.body.amount, 99 + 19.5);
    // The base line of the new order is pinned at the edited catalogue; overage lines carry no terms.
    const stored = (await orders(TRM2)).find((o) => o.status === "pending")!.products as Array<Record<string, unknown>>;
    assert.deepEqual(stored[0].terms, { price: 99, includedMinutes: 100, overageRate: 0.99, currency: "EUR" });
    assert.ok(!("terms" in stored[1]));
    await db.execute(sql`DELETE FROM app_settings WHERE key = 'product_catalogue_v1'`);
    console.log("  ✓ terms: preview writes nothing (no order/event/HYP), paid lines carry terms, an edit after payment changes nothing for that period (billing-stats + 80% warning only), the next checkout lists the changes, a finished period's overage at its pinned terms");
  }

  // ── 7. Currency lock (VP decision iii) ──────────────────────────────
  {
    const { setProductCatalogue } = await import("../../lib/products");
    const { defaultProductCatalogue } = await import("../../lib/product-catalogue");
    for (const uid of [FX, FX2]) {
      await db.execute(sql`INSERT INTO users (id, email, password_hash, display_name, locale, subscription_status, subscription_plan, trial_ends_at, products)
        VALUES (${uid}, ${`${uid.slice(-4)}@example.test`}, 'x', 'Exemple Test', 'fr', 'active', 'global', now() + interval '1 day', ${JSON.stringify({ base: "reception", addons: [] })}::jsonb)`);
      // A FINISHED period paid in EUR at the default terms (200 min, 0.39).
      await db.execute(sql`INSERT INTO payment_orders (user_id, plan_key, period, currency, coin, expected_amount, status, expires_at, paid_at, products)
        VALUES (${uid}, 'global', 'monthly', 'EUR', '3', 89, 'paid', ${T0.toISOString()}, ${T0.toISOString()},
        ${JSON.stringify([{ ...baseLine, terms: baseTerms, periodStart: T0.toISOString(), periodEnd: T1.toISOString() }])}::jsonb)`);
    }
    await usage(FX, 250, mid); // 50 min over the pinned 200
    await usage(FX2, 150, mid); // within the included minutes
    // The EUR rate edited since: the pending overage keeps the pinned 0.39.
    const edited = defaultProductCatalogue();
    edited.reception.EUR.overagePerMin = 0.99;
    edited.reception.ILS.overagePerMin = 2.5;
    await setProductCatalogue(edited);
    const ilsBody = { products: { base: "reception", addons: [] }, period: "monthly", locale: "he" };
    const refused = { status: 409, body: { error: "overage_currency_pending", currency: "EUR", amount: 19.5 } };
    as(FX);
    const ordersBefore = (await orders(FX)).length;
    const evBefore = await eventsOf(FX);
    const xFx = await xminOf(FX);
    const fetchBefore = unreachableCalls;
    hypUnreachable();
    // PRODUCT_ORDERS still gates first.
    delete process.env.PRODUCT_ORDERS;
    assert.deepEqual(await post(ilsBody), disabled);
    process.env.PRODUCT_ORDERS = "on";
    const sw = await post(ilsBody);
    assert.deepEqual(sw, refused);
    assert.deepEqual(Object.keys(sw.body), ["error", "currency", "amount"], "no message string in the 409");
    assert.deepEqual(await post({ ...ilsBody, preview: true }), refused, "the preview is refused the same way");
    globalThis.fetch = mockFetch;
    assert.equal(unreachableCalls, fetchBefore, "a refused currency switch invoked fetch (HYP)");
    assert.equal((await orders(FX)).length, ordersBefore, "a refused currency switch wrote an order");
    assert.equal(await eventsOf(FX), evBefore, "a refused currency switch wrote an event");
    assert.equal(await xminOf(FX), xFx, "a refused currency switch touched the user row");
    // The same currency: the order carries the overage at the PINNED rate.
    const same = await post(body);
    assert.equal(same.status, 200, JSON.stringify(same.body));
    assert.deepEqual(same.body.lines, [baseLine, overage]);
    assert.equal(same.body.amount, 89 + 19.5);
    assert.equal(lastSign().Amount, "108.50");
    // No pending overage: a currency switch is allowed.
    as(FX2);
    const sw2 = await post(ilsBody);
    assert.equal(sw2.status, 200, JSON.stringify(sw2.body));
    assert.equal(sw2.body.currency, "ILS");
    assert.deepEqual(sw2.body.lines, [{ kind: "base", product: "reception", period: "monthly", amount: 349 }]);
    await db.execute(sql`DELETE FROM app_settings WHERE key = 'product_catalogue_v1'`);
    console.log("  ✓ currency lock: EUR overage pending → ILS order and preview 409 { overage_currency_pending, EUR, 19.5 } (no order/event/user write, HYP never called), PRODUCT_ORDERS refuses first, EUR order carries it at the pinned rate, no pending overage → switch allowed");
  }

  // Nothing ever left the process for HYP but the mock host.
  assert.ok(mock.hypRequests.every((r) => r.params.Masof === "0000000001"));
  as(null);
  delete process.env.PRODUCT_ORDERS;
  console.log("hyp-orders DB: all passed");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
