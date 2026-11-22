// P2 (per-product usage, calls.product, usage warnings) against a THROWAWAY
// Postgres, through the real code:
//   1. calls.product: the calls/end insert values write NULL; the CHECK
//      refuses an unknown product;
//   2. billing-stats:
//      - grandfathered: the exact pre-P2 top-level keys, no usageByProduct,
//        and byte-identical whatever calls.product holds;
//      - record-holder: the SAME bytes once usageByProduct is removed
//        (purely additive), and the per-entry numbers over real rows;
//      - trialing / trial_paused: the sign-up trial cap with the gate's count;
//      - annual: a record-holder's usage is this monthly sub-period (the
//        billed bounds) vs the monthly minutes; grandfathered annual unchanged;
//   3. the dashboard calls list / detail and logs responses are
//      byte-identical with calls.product NULL and set;
//   4. usage warnings with the REAL deps (query, claim, usage) and only the
//      sender injected: flag off = nothing; flag on: a grandfathered paying
//      account at 150% and an invalid record get no email and no claim row;
//      a record-holder at 80% then 100% gets one email each; a re-run sends
//      nothing; a new period resets; no address in events;
//   5. concurrency: two runs at once → one email per claim.
// Plain `npm test` skips it. Run it with:  bash scripts/products-usage-db.sh
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read
// from the shell. Mock data only (example.test). Dynamic imports only after
// the env checks.

import assert from "node:assert/strict";

const url = process.env.PRODUCTS_USAGE_DB_TEST_URL;
if (!url) {
  console.log("skip: products usage DB part (no PRODUCTS_USAGE_DB_TEST_URL — see scripts/products-usage-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /^(LIVEKIT|TWILIO|RESEND|WHATSAPP|GOOGLE)|OPENAI|REALTIME_API_KEY|EMAIL_FROM|USAGE_WARNINGS/i.test(k))) {
  throw new Error("refusing to run with provider env set");
}
if (!(globalThis as { __campgateHooks?: boolean }).__campgateHooks) throw new Error("module hooks missing: run through scripts/products-usage-db.sh");
process.env.DATABASE_URL = url;

const g = globalThis as { __campgateSession?: { user: { id: string } } | null };
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ADMIN = id(0xad);
const GF = id(0x01); // grandfathered, premium, active
const REC = id(0x02); // record: reception_multi + sales
const BAD = id(0x03); // invalid record
const REC2 = id(0x04); // record: reception (the warnings account)
const TRIAL = id(0x05); // record but trialing

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { calls } = await import("../../lib/db/schema");
  const { callInsertValues, parseCallEndBody } = await import("../../lib/call-end-body");
  const { PLANS, OVERAGE_RATE_ILS_PER_MIN } = await import("../../lib/plans");
  const { DEFAULT_PRODUCT_CATALOGUE } = await import("../../lib/product-catalogue");
  const { runUsageWarnings } = await import("../../lib/usage-warnings");
  const { usageWarningDeps } = await import("../../lib/usage-warnings-deps");
  const billing = await import("../../app/api/dashboard/billing-stats/route");
  const callsRoute = await import("../../app/api/dashboard/calls/route");
  const callRoute = await import("../../app/api/dashboard/calls/[id]/route");
  const eventsRoute = await import("../../app/api/dashboard/events/route");

  const rows = async <T>(q: ReturnType<typeof sql>) => {
    const r = (await db.execute(q)) as unknown;
    return (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as T[];
  };
  const count = async (q: ReturnType<typeof sql>) => Number((await rows<{ n: number }>(q))[0].n);

  await db.execute(sql`DELETE FROM users WHERE email LIKE '%@usage.example.test'`);
  const NOW = Date.now();
  const paidUntil = new Date(NOW + 10 * 86400_000); // window = [paidUntil - 1 month, paidUntil]
  type Seed = [string, string, string, unknown, string];
  const seeds: Seed[] = [
    [ADMIN, "premium", "active", null, "fr"],
    [GF, "premium", "active", null, "fr"],
    [REC, "premium", "active", { base: "reception_multi", addons: ["sales"] }, "he"],
    [BAD, "premium", "active", { base: "gold", addons: [] }, "fr"],
    [REC2, "global", "active", { base: "reception", addons: [] }, "en"],
    [TRIAL, "premium", "trialing", { base: "reception", addons: [] }, "fr"],
  ];
  for (const [uid, plan, status, products, locale] of seeds) {
    await db.execute(sql`INSERT INTO users (id, email, password_hash, role, subscription_plan, subscription_status, subscription_period, paid_until, locale, products)
      VALUES (${uid}, ${`${uid.slice(-4)}@usage.example.test`}, 'x', ${uid === ADMIN ? "admin" : "user"}, ${plan}, ${status}, 'monthly',
              ${status === "active" ? paidUntil.toISOString() : null}, ${locale}, ${products === null ? null : JSON.stringify(products)}::jsonb)`);
  }
  const inWindow = new Date(NOW - 2 * 86400_000).toISOString();

  // ── 1. calls.product at call end ─────────────────────────────────────
  const [row] = await db
    .insert(calls)
    .values(callInsertValues(parseCallEndBody({ fromNumber: "+15550000101", toNumber: "+15550000102", durationSeconds: 120, clientAgent: true }), GF, "room-hash-1"))
    .returning({ id: calls.id, product: calls.product });
  assert.equal(row.product, null, "calls/end writes NULL (= reception)");
  await assert.rejects(db.execute(sql`UPDATE calls SET product = 'gold' WHERE id = ${row.id}`), (e: unknown) => /calls_product_check/.test(String((e as { cause?: { message?: string } }).cause?.message ?? e)), "CHECK refuses an unknown product");
  for (const p of ["reception", "sales", "connect", null]) await db.execute(sql`UPDATE calls SET product = ${p} WHERE id = ${row.id}`);
  await db.execute(sql`UPDATE calls SET created_at = ${inWindow}, summary = 'Mock summary', transcript = '[{"role":"user","text":"hello"}]'::jsonb WHERE id = ${row.id}`);
  console.log("ok: calls.product NULL at call end, CHECK in (reception, sales, connect)");

  // Usage rows: GF and REC get inbound + campaign seconds.
  const addCall = (uid: string, seconds: number, product: string | null) =>
    db.execute(sql`INSERT INTO calls (user_id, from_number, to_number, duration_seconds, product, created_at) VALUES (${uid}, '+15550000103', '+15550000104', ${seconds}, ${product}, ${inWindow})`);
  const addCampaignCall = async (uid: string, seconds: number) => {
    const [c] = await rows<{ id: string }>(sql`INSERT INTO campaigns (user_id, name, status) VALUES (${uid}, 'Mock campaign', 'running') RETURNING id`);
    const [k] = await rows<{ id: string }>(sql`INSERT INTO campaign_contacts (campaign_id, user_id, phone_number, status) VALUES (${c.id}, ${uid}, '+15550000105', 'done') RETURNING id`);
    await db.execute(sql`INSERT INTO campaign_calls (campaign_id, contact_id, user_id, phone_number, duration_seconds, created_at) VALUES (${c.id}, ${k.id}, ${uid}, '+15550000105', ${seconds}, ${inWindow})`);
  };
  await addCall(GF, 600, null);
  await addCampaignCall(GF, 300);
  await addCall(REC, 460 * 60, null);
  await addCall(REC, 60, "connect");
  await addCampaignCall(REC, 300 * 60);

  // ── 2. billing-stats ─────────────────────────────────────────────────
  const stats = async (uid: string) => {
    g.__campgateSession = { user: { id: ADMIN } };
    const res = await billing.GET(new NextRequest(`http://localhost/api/dashboard/billing-stats?asUserId=${uid}`));
    assert.equal(res.status, 200);
    return res.text();
  };
  const PRE_P2_KEYS = [
    "plan", "status", "period", "paidUntil", "trialEndsAt", "autoRenew", "cancelledAt", "scheduledPlan",
    "scheduledPlanPeriod", "scheduledPlanAt", "card", "currency", "window", "usage", "callsPerDay", "outcomes", "payments",
  ];
  {
    const base = await stats(GF);
    const body = JSON.parse(base) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), PRE_P2_KEYS, "grandfathered: the pre-P2 keys, in order");
    assert.ok(!base.includes("usageByProduct"), "grandfathered: no usageByProduct");
    const premium = PLANS.find((p) => p.key === "premium")!;
    assert.deepEqual(body.usage, { minutesUsed: Math.round((600 + 120 + 300) / 60), minutesIncluded: premium.minutesIncluded, overageRateIls: OVERAGE_RATE_ILS_PER_MIN });
    // Byte-identical whatever calls.product holds.
    for (const p of ["reception", "sales", "connect", null]) {
      await db.execute(sql`UPDATE calls SET product = ${p} WHERE user_id = ${GF}`);
      assert.equal(await stats(GF), base, `grandfathered byte-identical with calls.product = ${p}`);
    }
    // An invalid record is grandfathered: same shape.
    const bad = JSON.parse(await stats(BAD)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(bad), PRE_P2_KEYS, "invalid record: the pre-P2 keys");
  }
  {
    const withRecord = await stats(REC);
    const body = JSON.parse(withRecord) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), [...PRE_P2_KEYS.slice(0, PRE_P2_KEYS.indexOf("usage") + 1), "usageByProduct", ...PRE_P2_KEYS.slice(PRE_P2_KEYS.indexOf("usage") + 1)]);
    // Purely additive: the record removed, the response is the same minus the field.
    const { usageByProduct, ...rest } = body;
    await db.execute(sql`UPDATE users SET products = NULL WHERE id = ${REC}`);
    assert.equal(JSON.stringify(rest), await stats(REC), "record-holder = grandfathered bytes + usageByProduct");
    await db.execute(sql`UPDATE users SET products = ${JSON.stringify({ base: "reception_multi", addons: ["sales"] })}::jsonb WHERE id = ${REC}`);
    const ILS = DEFAULT_PRODUCT_CATALOGUE;
    assert.deepEqual(usageByProduct, {
      kind: "products",
      currency: "ILS",
      entries: [
        { entry: "reception", owned: true, products: ["reception_multi"], usedSeconds: 460 * 60, usedMinutes: 460, includedMinutes: ILS.reception_multi.ILS.minutes, overageMinutes: 10, overageRate: 1.5, overageAmount: 15 },
        { entry: "sales", owned: true, products: ["sales"], usedSeconds: 300 * 60, usedMinutes: 300, includedMinutes: ILS.sales.ILS.minutes, overageMinutes: 50, overageRate: 1.9, overageAmount: 95 },
        { entry: "connect", owned: false, products: [], usedSeconds: 60, usedMinutes: 1, includedMinutes: 0, overageMinutes: 1, overageRate: 1.5, overageAmount: 1.5 },
      ],
    });
  }
  console.log("ok: billing-stats grandfathered byte-identical, record-holder additive usageByProduct");

  // ── 2b. billing-stats while trialing: the sign-up trial cap ──────────
  // The reception entry shows TRIAL_MINUTES_INCLUDED and exactly the seconds
  // the inbound trial gate counts (all time, not the period), no overage, and
  // `signupTrial`; once paid, the catalogue over the period again.
  // Grandfathered trialing: no usageByProduct, bytes unmoved by old calls.
  {
    const { TRIAL_MINUTES_INCLUDED } = await import("../../lib/trial");
    const { inboundTrialRefusal, signupTrialSecondsUsed } = await import("../../lib/agent/session-config/trial-gate");
    const ends = new Date(NOW + 5 * 86400_000);
    const old = new Date(NOW - 400 * 86400_000).toISOString(); // far outside any period window
    await db.execute(sql`UPDATE users SET trial_ends_at = ${ends.toISOString()} WHERE id = ${TRIAL}`);
    await db.execute(sql`DELETE FROM calls WHERE user_id = ${TRIAL}`);
    await addCall(TRIAL, 30 * 60, null);
    await addCall(TRIAL, 5 * 60, "connect");
    await db.execute(sql`INSERT INTO calls (user_id, from_number, to_number, duration_seconds, product, created_at) VALUES (${TRIAL}, '+15550000103', '+15550000104', ${80 * 60}, NULL, ${old})`);
    const gateSeconds = await signupTrialSecondsUsed(TRIAL);
    assert.equal(gateSeconds, (30 + 5 + 80) * 60, "gate count: every calls row, all time");
    const refusal = await inboundTrialRefusal({ id: TRIAL, subscriptionStatus: "trialing", trialEndsAt: ends, role: "user" });
    assert.equal(refusal?.cause, "minutes", "115 min > 100: the gate refuses");
    assert.equal(refusal?.trialSecondsUsed, gateSeconds, "the gate reports the same count");
    type Entry = Record<string, unknown> & { entry: string };
    const receptionOf = async () => {
      const body = JSON.parse(await stats(TRIAL)) as { usageByProduct: { kind: string; entries: Entry[] } };
      assert.equal(body.usageByProduct.kind, "products");
      return { all: body.usageByProduct.entries, reception: body.usageByProduct.entries.find((x) => x.entry === "reception")! };
    };
    for (const status of ["trialing", "trial_paused"]) {
      await db.execute(sql`UPDATE users SET subscription_status = ${status} WHERE id = ${TRIAL}`);
      const { all, reception } = await receptionOf();
      assert.equal(TRIAL_MINUTES_INCLUDED, 100);
      assert.deepEqual(reception, {
        entry: "reception",
        owned: true,
        products: ["reception"],
        usedSeconds: gateSeconds,
        usedMinutes: Math.round(gateSeconds / 60),
        includedMinutes: 100,
        overageMinutes: 0,
        overageRate: DEFAULT_PRODUCT_CATALOGUE.reception.EUR.overagePerMin,
        overageAmount: 0,
        signupTrial: { endsAt: ends.toISOString(), minutesIncluded: 100, usedMinutes: Math.round(gateSeconds / 60) },
      }, `${status}: the trial cap, the gate's count`);
      assert.ok(all.every((x) => x.overageMinutes === 0 && x.overageAmount === 0), `${status}: no overage on any entry`);
    }
    // Paid: the catalogue minutes over the period, no signupTrial.
    await db.execute(sql`UPDATE users SET subscription_status = 'active', paid_until = ${paidUntil.toISOString()} WHERE id = ${TRIAL}`);
    {
      const { reception } = await receptionOf();
      assert.ok(!("signupTrial" in reception), "active: no signupTrial");
      assert.equal(reception.includedMinutes, DEFAULT_PRODUCT_CATALOGUE.reception.EUR.minutes, "active: catalogue minutes");
      assert.equal(reception.usedSeconds, 30 * 60, "active: the period only (the old call is outside)");
    }
    await db.execute(sql`UPDATE users SET subscription_status = 'trialing', paid_until = NULL WHERE id = ${TRIAL}`);
    // Grandfathered trialing (no record): pre-P2 keys, and old calls change no byte.
    await db.execute(sql`UPDATE users SET products = NULL WHERE id = ${TRIAL}`);
    await db.execute(sql`DELETE FROM calls WHERE user_id = ${TRIAL} AND created_at = ${old}`);
    const gfTrial = await stats(TRIAL);
    assert.deepEqual(Object.keys(JSON.parse(gfTrial) as object), PRE_P2_KEYS, "grandfathered trialing: the pre-P2 keys");
    await db.execute(sql`INSERT INTO calls (user_id, from_number, to_number, duration_seconds, product, created_at) VALUES (${TRIAL}, '+15550000103', '+15550000104', ${80 * 60}, NULL, ${old})`);
    assert.equal(await stats(TRIAL), gfTrial, "grandfathered trialing: byte-identical with an old call added");
    await db.execute(sql`UPDATE users SET products = ${JSON.stringify({ base: "reception", addons: [] })}::jsonb, trial_ends_at = NULL WHERE id = ${TRIAL}`);
    await db.execute(sql`DELETE FROM calls WHERE user_id = ${TRIAL}`);
  }
  console.log("ok: billing-stats trialing / trial_paused shows the sign-up trial cap with the gate's count; active = catalogue; grandfathered unchanged");

  // ── 2c. Annual accounts: this monthly sub-period ─────────────────────
  // Catalogue minutes are per MONTH. An annual record-holder's usageByProduct
  // (and its warnings' period) is the current monthly sub-period of its paid
  // annual coverage, with the boundaries overage billing uses
  // (billingPeriodsOf). A grandfathered annual account keeps its legacy
  // pool over the whole paid year, with no usageByProduct.
  {
    const ANN = id(0x06); // record: reception, annual, EN → EUR
    const GFA = id(0x07); // grandfathered, annual
    const { addPeriod } = await import("../../lib/billing-activation");
    const { billingPeriodsOf } = await import("../../lib/order-lines");
    const covStart = new Date(NOW - 40 * 86400_000);
    const covEnd = addPeriod(covStart, "annual");
    for (const [uid, products] of [[ANN, { base: "reception", addons: [] }], [GFA, null]] as const) {
      await db.execute(sql`INSERT INTO users (id, email, password_hash, role, subscription_plan, subscription_status, subscription_period, paid_until, locale, products)
        VALUES (${uid}, ${`${uid.slice(-4)}@usage.example.test`}, 'x', 'user', 'global', 'active', 'annual', ${covEnd.toISOString()}, 'en',
                ${products === null ? null : JSON.stringify(products)}::jsonb)`);
    }
    const months = billingPeriodsOf({ start: covStart, end: covEnd, period: "annual", base: "reception", addons: [] });
    const current = months.find((m) => m.start.getTime() <= NOW && NOW < m.end.getTime())!;
    assert.equal(months.indexOf(current), 1, "the fixture sits in the second month");
    const callAt = (uid: string, minutes: number, at: Date) =>
      db.execute(sql`INSERT INTO calls (user_id, from_number, to_number, duration_seconds, product, created_at) VALUES (${uid}, '+15550000106', '+15550000107', ${minutes * 60}, NULL, ${at.toISOString()})`);
    const inMonth1 = new Date(covStart.getTime() + 2 * 86400_000);
    const inMonth2 = new Date(Math.max(current.start.getTime() + 3600_000, NOW - 86400_000));
    for (const uid of [ANN, GFA]) {
      await callAt(uid, 150, inMonth1);
      await callAt(uid, 170, inMonth2);
    }
    type Entry = { entry: string; usedSeconds: number; usedMinutes: number; includedMinutes: number; overageMinutes: number };
    const receptionOf = async (uid: string) => {
      const body = JSON.parse(await stats(uid)) as { usageByProduct: { entries: Entry[] }; window: { start: string; end: string } };
      return { body, reception: body.usageByProduct.entries.find((x) => x.entry === "reception")! };
    };
    const monthly = DEFAULT_PRODUCT_CATALOGUE.reception.EUR.minutes;
    // Without a multi-line order: anchored on the paid window (paidUntil - 1 year).
    {
      const { body, reception } = await receptionOf(ANN);
      assert.equal(reception.usedSeconds, 170 * 60, "annual record-holder: this month's usage only");
      assert.equal(reception.includedMinutes, monthly, "vs the MONTHLY included minutes");
      assert.equal(reception.overageMinutes, Math.max(0, 170 - monthly));
      assert.deepEqual(body.window, { start: covStart.toISOString(), end: covEnd.toISOString(), kind: "paid" }, "the top-level window stays the paid year");
    }
    // With the paid multi-line annual order: anchored on its coverage (the billed bounds).
    await db.execute(sql`INSERT INTO payment_orders (user_id, plan_key, period, currency, coin, expected_amount, status, expires_at, paid_at, products)
      VALUES (${ANN}, 'global', 'annual', 'EUR', '3', 890, 'paid', ${covStart.toISOString()}, ${covStart.toISOString()},
      ${JSON.stringify([{ kind: "base", product: "reception", period: "annual", amount: 890, periodStart: covStart.toISOString(), periodEnd: covEnd.toISOString() }])}::jsonb)`);
    {
      const { reception } = await receptionOf(ANN);
      assert.equal(reception.usedSeconds, 170 * 60, "with the paid coverage: this month's usage only");
      assert.equal(reception.includedMinutes, monthly);
      // A call exactly on the month's start counts in this month (the billed [start, end)).
      await callAt(ANN, 5, current.start);
      assert.equal((await receptionOf(ANN)).reception.usedSeconds, 175 * 60, "a call on the month boundary belongs to the new month");
    }
    // The warnings' window: this month, so period_start = the billed month start.
    {
      const { usageWarningDeps } = await import("../../lib/usage-warnings-deps");
      const [row] = await rows<Record<string, unknown>>(sql`SELECT id, email, locale, paid_until AS "paidUntil", subscription_plan AS "subscriptionPlan",
        subscription_status AS "subscriptionStatus", subscription_period AS "subscriptionPeriod", trial_ends_at AS "trialEndsAt", products FROM users WHERE id = ${ANN}`);
      const acct = { ...row, paidUntil: new Date(row.paidUntil as string), trialEndsAt: null } as unknown as Parameters<ReturnType<typeof usageWarningDeps>["usageFor"]>[0];
      const r = await usageWarningDeps().usageFor(acct, new Date(NOW));
      assert.equal(r.periodStart.toISOString(), current.start.toISOString(), "warnings: period_start = this month's billed start");
      assert.ok(r.usage.kind === "products" && r.usage.entries.find((x) => x.entry === "reception")!.usedSeconds === 175 * 60, "warnings: this month's usage");
    }
    // Grandfathered annual: the legacy pool over the whole paid year, no usageByProduct.
    {
      const text = await stats(GFA);
      const body = JSON.parse(text) as Record<string, unknown> & { usage: { minutesUsed: number } };
      assert.deepEqual(Object.keys(body), PRE_P2_KEYS, "grandfathered annual: the pre-P2 keys");
      assert.equal(body.usage.minutesUsed, 150 + 170, "grandfathered annual: the pool over the whole year");
      // Byte-identical whatever calls.product holds (no per-product path at all).
      for (const p of ["reception", "sales", "connect", null]) {
        await db.execute(sql`UPDATE calls SET product = ${p} WHERE user_id = ${GFA}`);
        assert.equal(await stats(GFA), text, `grandfathered annual byte-identical with calls.product = ${p}`);
      }
    }
    await db.execute(sql`DELETE FROM payment_orders WHERE user_id IN (${ANN}, ${GFA})`);
    await db.execute(sql`DELETE FROM users WHERE id IN (${ANN}, ${GFA})`);
  }
  console.log("ok: annual record-holder: this monthly sub-period vs monthly minutes (window + coverage anchor, warnings period); grandfathered annual unchanged");

  // ── 3. Dashboard calls / logs: byte-identical, calls.product NULL vs set ─
  {
    await db.execute(sql`INSERT INTO events (user_id, source, event, message, metadata) VALUES (${GF}, 'agent', 'call_received', 'mock', ${JSON.stringify({ callId: row.id, toNumber: "+15550000102" })}::jsonb)`);
    g.__campgateSession = { user: { id: GF } };
    const since = new Date(NOW - 20 * 86400_000).toISOString();
    const until = new Date(NOW + 86400_000).toISOString();
    const listText = async () => (await callsRoute.GET(new NextRequest(`http://localhost/api/dashboard/calls?since=${since}&until=${until}`))).text();
    const detailText = async () => (await callRoute.GET(new NextRequest(`http://localhost/api/dashboard/calls/${row.id}`), { params: Promise.resolve({ id: row.id }) })).text();
    // serverTime is the request clock; everything else must match byte for byte.
    const logsText = async () =>
      (await (await eventsRoute.GET(new NextRequest("http://localhost/api/dashboard/events"))).text()).replace(/"serverTime":"[^"]+"/, '"serverTime":"<now>"');
    await db.execute(sql`UPDATE calls SET product = NULL WHERE user_id = ${GF}`);
    const [l0, d0, e0] = [await listText(), await detailText(), await logsText()];
    assert.ok(l0.includes(row.id), "the call is listed");
    assert.ok(d0.includes(row.id) && !d0.includes('"error"'), "the call detail is served");
    for (const p of ["reception", "sales", "connect"]) {
      await db.execute(sql`UPDATE calls SET product = ${p} WHERE user_id = ${GF}`);
      assert.equal(await listText(), l0, `calls list byte-identical (${p})`);
      assert.equal(await detailText(), d0, `call detail byte-identical (${p})`);
      assert.equal(await logsText(), e0, `logs byte-identical (${p})`);
    }
    for (const t of [l0, d0]) assert.ok(!/"product"/.test(t), "no product field served");
    await db.execute(sql`UPDATE calls SET product = NULL WHERE user_id = ${GF}`);
  }
  console.log("ok: dashboard calls list / detail and logs byte-identical, calls.product NULL vs set");

  // ── 4. Usage warnings, real deps, sender injected ───────────────────
  type Sent = { to: string; threshold: number; entry: string; locale: string };
  const sent: Sent[] = [];
  const deps = (env: Record<string, string>) =>
    usageWarningDeps({
      env,
      send: async (to, input) => {
        sent.push({ to, threshold: input.threshold, entry: input.entry, locale: input.locale });
        return { ok: true };
      },
    });
  const claims = () => count(sql`SELECT count(*)::int AS n FROM usage_warnings`);
  const ON = { USAGE_WARNINGS_ENABLED: "1" };
  // Isolate: only GF, BAD, REC2, TRIAL are warning candidates here.
  await db.execute(sql`UPDATE users SET products = NULL WHERE id = ${REC}`);
  await db.execute(sql`DELETE FROM calls WHERE user_id IN (${GF}, ${BAD}, ${REC2}, ${TRIAL})`);
  const included = DEFAULT_PRODUCT_CATALOGUE.reception.EUR.minutes; // REC2: reception, EN → EUR
  const premium = PLANS.find((p) => p.key === "premium")!;
  await addCall(GF, Math.ceil(premium.minutesIncluded * 60 * 1.5), null); // grandfathered at 150% of its pool
  await addCall(BAD, 10 * 3600, null);
  await addCall(TRIAL, 10 * 3600, null);
  const setRec2 = async (pct: number) => {
    await db.execute(sql`DELETE FROM calls WHERE user_id = ${REC2}`);
    await addCall(REC2, Math.floor((included * 60 * pct) / 100), null);
  };

  // Flag off: nothing.
  await setRec2(150);
  for (const env of [{}, { USAGE_WARNINGS_ENABLED: "0" }] as Record<string, string>[]) {
    assert.deepEqual(await runUsageWarnings(deps(env)), { enabled: false, accounts: 0, claimed: 0, sent: 0, failed: 0 });
  }
  assert.equal(sent.length, 0);
  assert.equal(await claims(), 0, "flag off: no claim row");

  // Flag on: thresholds on REC2; GF / BAD / TRIAL never.
  const steps: Array<[number, number[]]> = [
    [79, []],
    [80, [80]],
    [99, [80]],
    [100, [80, 100]],
    [150, [80, 100]],
  ];
  for (const [pct, want] of steps) {
    await setRec2(pct);
    await runUsageWarnings(deps(ON));
    assert.deepEqual(sent.map((s) => s.threshold), want, `REC2 at ${pct}%`);
  }
  assert.ok(sent.every((s) => s.to === `${REC2.slice(-4)}@usage.example.test` && s.entry === "reception" && s.locale === "en"), "only REC2, its own address, its locale");
  assert.equal(await count(sql`SELECT count(*)::int AS n FROM usage_warnings WHERE user_id IN (${GF}, ${BAD}, ${TRIAL})`), 0, "grandfathered at 150% / invalid / trial: no claim row");
  assert.equal(await claims(), 2);
  // A new period (paid_until moves a month on): resets.
  await db.execute(sql`UPDATE users SET paid_until = paid_until + interval '1 month' WHERE id = ${REC2}`);
  await db.execute(sql`UPDATE calls SET created_at = (SELECT paid_until FROM users WHERE id = ${REC2}) - interval '1 day' WHERE user_id = ${REC2}`);
  await runUsageWarnings(deps(ON));
  assert.deepEqual(sent.map((s) => s.threshold), [80, 100, 100], "new period: one email (both crossed, 100)");
  assert.equal(await claims(), 4);
  const ev = await rows<{ metadata: unknown; message: string }>(sql`SELECT metadata, message FROM events WHERE event LIKE 'usage_warning%'`);
  assert.equal(ev.length, 3, "one event per email");
  assert.doesNotMatch(JSON.stringify(ev), /@|example\.test/, "no address in events");
  console.log("ok: warnings 79/80/99/100/150%, dedupe, new period, flag off, grandfathered / invalid / trial never, no address");

  // ── 5. Concurrency: two runs at once → one email per claim ──────────
  await db.execute(sql`DELETE FROM usage_warnings`);
  sent.length = 0;
  const results = await Promise.all([runUsageWarnings(deps(ON)), runUsageWarnings(deps(ON)), runUsageWarnings(deps(ON))]);
  const totalClaimed = results.reduce((s, r) => s + r.claimed, 0);
  assert.equal(totalClaimed, 2, "each threshold claimed once across concurrent runs");
  assert.equal(await claims(), 2);
  assert.equal(sent.length, results.reduce((s, r) => s + r.sent, 0));
  assert.ok(sent.length >= 1 && sent.length <= 2, "at most one email per claim");
  assert.equal(new Set(sent.map((s) => s.threshold)).size, sent.length, "never the same threshold twice");
  console.log(`ok: concurrency, ${results.length} runs at once: ${totalClaimed} claims, ${sent.length} email(s)`);

  console.log("ALL PRODUCTS USAGE DB TESTS PASSED");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
