// HYP multi-line orders (P4) against a THROWAWAY Postgres, through the real
// routes, with a fake HYP (fixtures/hyp-orders/mock-hyp.ts: globalThis.fetch
// answers ONLY the mock host, anything else throws) and a recording email
// double (no email is ever sent):
//   1. LEGACY byte-identity: the `{ plan, period, locale }` body, end to end
//      (SIGN request, order row, callback DB effects, events, email, replay,
//      billing-stats) is identical to the recorded fixture
//      fixtures/hyp-orders/legacy-capture.json;
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
//      carries it; a grandfathered account never gets one.
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
if (Object.keys(process.env).some((k) => /HYP|^(LIVEKIT|TWILIO|RESEND|WHATSAPP|GOOGLE)|OPENAI|REALTIME_API_KEY|EMAIL_FROM|ADMIN_ALERT|CAMPAIGN_DISPATCH|CLIENT_AGENT|APP_URL/i.test(k))) {
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
  assert.equal(text, fixture, "the legacy payment differs from the recorded fixture");
  // Sanity on what the fixture pins: no lines anywhere on a legacy order.
  for (const [k, v] of Object.entries(capture)) {
    const c = v as { signRequests: Array<Record<string, string>>; billingStats: { body: { payments: Array<Record<string, unknown>> } }; emails: unknown[] };
    assert.equal(c.signRequests.length, 1, k);
    assert.equal(c.emails.length, 1, k);
    assert.equal(c.billingStats.body.payments.length, 1, k);
    assert.ok(!("lines" in c.billingStats.body.payments[0]), k);
  }
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../../lib/db");
  const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => {
    const r = (await db.execute(q)) as unknown;
    return (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as T[];
  };
  const legacyProducts = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM payment_orders WHERE products IS NOT NULL`);
  assert.equal(legacyProducts[0].n, 0, "a legacy order wrote payment_orders.products");
  console.log(`  ✓ legacy: ${Object.keys(capture).length} cases identical to the recorded fixture (SIGN, order row, callback effects, events, email, replay, billing-stats)`);

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
  assert.deepEqual({ ...a.body, url: undefined }, { url: undefined, amount: 89, currency: "EUR", lines: [baseLine] });
  assert.ok(String(a.body.url).startsWith(mock.MOCK_HYP_URL));
  let sign = lastSign();
  const [o1] = await orders(R1);
  assert.deepEqual(
    { Amount: sign.Amount, Coin: sign.Coin, Info: sign.Info, Order: sign.Order, PageLang: sign.PageLang, Masof: sign.Masof, tmp: sign.tmp, HK: sign.HK },
    { Amount: "89.00", Coin: "3", Info: "Réceptionniste (mensuel)", Order: o1.id, PageLang: "ENG", Masof: "0000000001", tmp: "3", HK: undefined },
  );
  assert.deepEqual(
    { plan_key: o1.plan_key, period: o1.period, expected_amount: o1.expected_amount, currency: o1.currency, coin: o1.coin, status: o1.status, products: o1.products },
    { plan_key: "global", period: "monthly", expected_amount: 89, currency: "EUR", coin: "3", status: "pending", products: [baseLine] },
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
  assert.deepEqual(paidLines, [{ ...baseLine, periodStart: paidAt1.toISOString(), periodEnd: paidUntil1.toISOString() }]);
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
  assert.deepEqual(sb.payments[0].lines, paidLines);
  console.log("  ✓ billing-stats: the multi-line invoice row carries `lines`");

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

  // Nothing ever left the process for HYP but the mock host.
  assert.ok(mock.hypRequests.every((r) => r.params.Masof === "0000000001"));
  as(null);
  console.log("hyp-orders DB: all passed");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
