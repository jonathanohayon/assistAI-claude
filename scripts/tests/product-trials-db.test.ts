// P3 (per-product trials, migration 0057) against a THROWAWAY Postgres,
// through the real code:
//   1. POST /api/dashboard/products/trial, the four gate cases (signed out,
//      the tenant, an admin via ?asUserId, a foreign ?asUserId from a
//      non-admin → 403, an invalid product → 400) and every refusal
//      (product_unavailable whatever the flags for reception / connect, sales
//      with dispatch off; product_owned; trial_used);
//   2. concurrency: N concurrent POSTs → exactly one row, one 201;
//   3. accountProducts: the additive `trials` and an ACTIVE trial entitling
//      its entry for the duration only;
//   4. sign-up: every door × usable / unusable through provisionTenant and
//      the Google path; an existing-account login writes nothing;
//   4b. sign-up (email + Google) through a not-yet-open sales / connect door
//      records its notify-me row at creation; fail-open; races → one row;
//   5. the sales trial cap in the dispatcher: paid and grandfathered accounts
//      byte-identical with no trial row vs an exhausted trial row; a
//      trial-only account dials under the cap, is refused (no dial, contact
//      queued, attempt given back, one event without PII) once the minutes
//      are used or the trial ended;
//   6. the inbound trial gate (call answering) is unchanged by trial rows;
//   7. billing-stats: usageByProduct.trials for a record-holder (additive);
//   8. trials[entry].startable equals "the POST returns 201" for every
//      seeded account, through the route and through startProductTrial.
// Plain `npm test` skips it. Run it with:  bash scripts/product-trials-db.sh
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read from
// the shell. Mock data only (example.test, +1555). Dynamic imports only after
// the env checks.

import assert from "node:assert/strict";

const url = process.env.PRODUCT_TRIALS_DB_TEST_URL;
if (!url) {
  console.log("skip: product trials DB part (no PRODUCT_TRIALS_DB_TEST_URL — see scripts/product-trials-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /^(LIVEKIT|TWILIO|RESEND|WHATSAPP|GOOGLE)|OPENAI|REALTIME_API_KEY|EMAIL_FROM|CAMPAIGN_DISPATCH|CLIENT_AGENT/i.test(k))) {
  throw new Error("refusing to run with provider env or product flags set");
}
if (!(globalThis as { __campgateHooks?: boolean }).__campgateHooks) throw new Error("module hooks missing: run through scripts/product-trials-db.sh");
process.env.DATABASE_URL = url;

const g = globalThis as {
  __campgateSession?: { user: { id: string; email?: string } } | null;
  __campgateDials?: Array<Record<string, unknown>>;
};
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ADMIN = id(0xad);
const TENANT = id(0x11); // sign-up record (reception_multi), trialing
const OTHER = id(0x12); // another sign-up record account (admin target)
const GF = id(0x13); // grandfathered premium (owns sales)
const RACE = id(0x14); // the concurrency account
const PAID = id(0x15); // paid record reception_multi + sales
const TRIALONLY = id(0x16); // record reception_multi, sales only via a trial

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const trialRoute = await import("../../app/api/dashboard/products/trial/route");
  const billing = await import("../../app/api/dashboard/billing-stats/route");
  const { accountProducts } = await import("../../lib/products");
  const { provisionTenant } = await import("../../lib/auth/provision-tenant");
  const { googleSignIn } = await import("../../lib/auth/google-sign-in");
  const { dispatchDueJobs } = await import("../../lib/campaigns/dispatch");
  const { inboundTrialRefusal } = await import("../../lib/agent/session-config/trial-gate");

  const rows = async <T>(q: ReturnType<typeof sql>) => {
    const r = (await db.execute(q)) as unknown;
    return (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as T[];
  };
  const count = async (q: ReturnType<typeof sql>) => Number((await rows<{ n: number }>(q))[0].n);
  const as = (uid: string | null) => {
    g.__campgateSession = uid ? { user: { id: uid, email: `${uid.slice(-4)}@example.test` } } : null;
  };
  const post = async (body: unknown, qs = "") => {
    const res = await trialRoute.POST(
      new NextRequest(`http://localhost/api/dashboard/products/trial${qs}`, {
        method: "POST",
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" } }),
      }),
    );
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
  };
  const withEnv = async <T>(env: Record<string, string>, f: () => Promise<T>): Promise<T> => {
    const prev: Record<string, string | undefined> = {};
    for (const k of Object.keys(env)) {
      prev[k] = process.env[k];
      process.env[k] = env[k];
    }
    try {
      return await f();
    } finally {
      for (const k of Object.keys(env)) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  };
  const trialRows = (uid: string) => count(sql`SELECT count(*)::int AS n FROM account_product_trials WHERE user_id = ${uid}`);

  const MULTI = JSON.stringify({ base: "reception_multi", addons: [] });
  const seeds: Array<[string, string, string, string | null]> = [
    [ADMIN, "premium", "active", null],
    [TENANT, "premium", "trialing", MULTI],
    [OTHER, "premium", "trialing", MULTI],
    [GF, "premium", "active", null],
    [RACE, "premium", "trialing", MULTI],
    [PAID, "premium", "active", JSON.stringify({ base: "reception_multi", addons: ["sales"] })],
    [TRIALONLY, "premium", "active", MULTI],
  ];
  const paidUntil = new Date(Date.now() + 10 * 86400_000).toISOString();
  for (const [uid, plan, status, products] of seeds) {
    await db.execute(sql`INSERT INTO users (id, email, password_hash, role, subscription_plan, subscription_status, subscription_period, paid_until, trial_ends_at, email_verified, locale, products)
      VALUES (${uid}, ${`${uid.slice(-4)}@trials.example.test`}, 'x', ${uid === ADMIN ? "admin" : "user"}, ${plan}, ${status}, 'monthly',
              ${status === "active" ? paidUntil : null}, ${status === "trialing" ? paidUntil : null}, true, 'fr', ${products}::jsonb)`);
  }

  // ── 1. POST: the gate cases and every refusal ─────────────────────────
  as(null);
  assert.equal((await post({ product: "sales" })).status, 401, "signed out → 401");
  as(TENANT);
  assert.equal((await post({ product: "sales" }, `?asUserId=${OTHER}`)).status, 403, "a non-admin with a foreign asUserId → 403");
  assert.equal(await trialRows(OTHER), 0);
  for (const bad of [{ product: "gold" }, { product: "Sales" }, {}, { product: null }, { product: ["sales"] }, null]) {
    const r = await post(bad);
    assert.equal(r.status, 400, `invalid ${JSON.stringify(bad)} → 400`);
    assert.equal(r.body?.error, "invalid_product");
  }
  assert.equal((await post("{not json")).status, 400, "malformed JSON → 400");
  // Flags off: nothing is startable.
  for (const p of ["reception", "reception_multi", "sales", "connect"]) {
    const r = await post({ product: p });
    assert.deepEqual([r.status, r.body?.error], [409, "product_unavailable"], `${p} with every flag off`);
  }
  // Every flag on: reception / connect still refused (their cap is not enforced).
  await withEnv({ CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" }, async () => {
    for (const p of ["reception", "reception_multi", "connect"]) {
      const r = await post({ product: p });
      assert.deepEqual([r.status, r.body?.error], [409, "product_unavailable"], `${p} with every flag on`);
    }
  });
  await withEnv({ CAMPAIGN_DISPATCH: "dry" }, async () => {
    assert.equal((await post({ product: "sales" })).body?.error, "product_unavailable", "dispatch dry → unavailable");
  });
  assert.equal(await trialRows(TENANT), 0, "no refusal wrote a row");

  await withEnv({ CAMPAIGN_DISPATCH: "on" }, async () => {
    // The tenant, on its own account.
    const before = Date.now();
    const r = await post({ product: "sales" });
    assert.equal(r.status, 201, "tenant → 201");
    const t = r.body!.trial as Record<string, unknown>;
    assert.deepEqual(Object.keys(t), ["product", "startedAt", "endsAt", "minutesIncluded"]);
    assert.equal(t.product, "sales");
    assert.equal(t.minutesIncluded, 30);
    const start = Date.parse(String(t.startedAt));
    assert.ok(start >= before - 1000 && start <= Date.now() + 1000);
    assert.equal(Date.parse(String(t.endsAt)) - start, 7 * 86400_000, "7 days");
    assert.deepEqual([(await post({ product: "sales" })).body?.error], ["trial_used"], "a second start → trial_used");
    assert.equal(await trialRows(TENANT), 1);
    // An admin, for a tenant via asUserId.
    as(ADMIN);
    const a = await post({ product: "sales" }, `?asUserId=${OTHER}`);
    assert.equal(a.status, 201, "admin via asUserId → 201");
    assert.equal(await trialRows(OTHER), 1);
    assert.equal(await trialRows(ADMIN), 0, "the admin's own account untouched");
    // Already owned (grandfathered premium has sales).
    const o = await post({ product: "sales" }, `?asUserId=${GF}`);
    assert.deepEqual([o.status, o.body?.error], [409, "product_owned"]);
    assert.equal(await trialRows(GF), 0);
    // Unknown account (admin, asUserId of nobody).
    assert.equal((await post({ product: "sales" }, `?asUserId=${id(0xfff)}`)).status, 404);
  });
  console.log("ok: POST trial — 401 / tenant 201 / admin asUserId 201 / foreign 403 / invalid 400 / unavailable / owned / used");

  // ── 2. Concurrency: exactly one row ────────────────────────────────────
  await withEnv({ CAMPAIGN_DISPATCH: "on" }, async () => {
    as(RACE);
    const results = await Promise.all(Array.from({ length: 12 }, () => post({ product: "sales" })));
    const codes = results.map((r) => (r.status === 201 ? "created" : String(r.body?.error))).sort();
    assert.deepEqual(codes, ["created", ...Array(11).fill("trial_used")], "one 201, the rest trial_used");
    assert.equal(await trialRows(RACE), 1, "exactly one row");
    // The unique index itself refuses a raw second row.
    await assert.rejects(
      db.execute(sql`INSERT INTO account_product_trials (user_id, product, ends_at, minutes_included) VALUES (${RACE}, 'sales', now(), 30)`),
      (e: unknown) => /account_product_trials_once/.test(String((e as { cause?: { message?: string } }).cause?.message ?? e)),
    );
    await assert.rejects(
      db.execute(sql`INSERT INTO account_product_trials (user_id, product, ends_at, minutes_included) VALUES (${RACE}, 'gold', now(), 30)`),
      (e: unknown) => /account_product_trials_product_check/.test(String((e as { cause?: { message?: string } }).cause?.message ?? e)),
    );
  });
  console.log("ok: 12 concurrent POSTs → 1 row; unique + CHECK in the database");

  // ── 3. accountProducts: additive trials, active = entitled ─────────────
  {
    const avail = { state: "available" };
    // `startable` is additive inside trials[entry]; these checks pin the
    // pre-existing fields byte-identical (startable is checked in 3b).
    const strip = <T extends { trials: Record<string, { startable: boolean }> }>(x: T) => {
      const trials: Record<string, unknown> = {};
      for (const [e, t] of Object.entries(x.trials)) {
        const { startable: _s, ...rest } = t;
        trials[e] = rest;
      }
      return { ...x, trials } as unknown as Omit<T, "trials"> & { trials: Record<string, Record<string, unknown>> };
    };
    const a = strip(await accountProducts(TENANT));
    assert.deepEqual(Object.keys(a), ["base", "addons", "entries", "source", "trials", "notifyRequested"]);
    assert.equal(a.trials.sales.state, "active");
    assert.ok(a.trials.sales.endsAt);
    assert.deepEqual(a.trials.reception, avail);
    assert.deepEqual(a.trials.connect, avail);
    assert.deepEqual([a.base, a.addons, a.entries, a.source], ["reception_multi", ["sales"], ["reception", "sales"], "products"], "the active trial entitles sales");
    await db.execute(sql`UPDATE account_product_trials SET started_at = now() - interval '8 days', ends_at = now() - interval '1 day' WHERE user_id = ${TENANT}`);
    const b = strip(await accountProducts(TENANT));
    assert.equal(b.trials.sales.state, "used");
    assert.deepEqual([b.base, b.addons, b.entries], ["reception_multi", [], ["reception"]], "an ended trial entitles nothing");
    const none = strip(await accountProducts(GF));
    assert.deepEqual(none.trials, { reception: avail, sales: avail, connect: avail });
    const unknown = strip(await accountProducts(id(0xfff)));
    assert.deepEqual(unknown, { base: null, addons: [], entries: [], source: "grandfathered", trials: { reception: avail, sales: avail, connect: avail }, notifyRequested: [] });
  }
  console.log("ok: accountProducts.trials (available / active / used), active entitles the entry, ended does not");

  // ── 4. Sign-up: each door × usable / unusable; login writes nothing ────
  {
    const doors: Array<["reception" | "sales" | "connect" | null, Record<string, string>, string[]]> = [
      [null, { CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" }, []],
      ["reception", { CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" }, []],
      ["sales", { CAMPAIGN_DISPATCH: "on" }, ["sales"]],
      ["sales", {}, []],
      ["sales", { CAMPAIGN_DISPATCH: "dry" }, []],
      ["connect", { CLIENT_AGENT: "all", CAMPAIGN_DISPATCH: "on" }, []], // cap not enforced: never at sign-up
      ["connect", {}, []],
    ];
    let i = 0;
    for (const [door, env, wantTrials] of doors) {
      const email = `signup${i++}@trials.example.test`;
      const created = await provisionTenant({ email, displayName: "Mock", plan: "premium", locale: "fr", emailVerified: false, passwordHash: "x", door }, { env });
      const [u] = await rows<{ products: unknown; status: string }>(sql`SELECT products, subscription_status AS status FROM users WHERE id = ${created.id}`);
      assert.deepEqual(u.products, { base: "reception_multi", addons: [] }, `door ${door}: base reception_multi`);
      assert.equal(u.status, "trialing", `door ${door}: the sign-up trial is unchanged`);
      const t = await rows<{ product: string; minutes: number; days: number }>(
        sql`SELECT product, minutes_included AS minutes, round(extract(epoch FROM ends_at - started_at) / 86400)::int AS days FROM account_product_trials WHERE user_id = ${created.id}`,
      );
      assert.deepEqual(t.map((r) => r.product), wantTrials, `door ${door} ${JSON.stringify(env)}: trials`);
      for (const r of t) assert.deepEqual([r.minutes, r.days], [30, 7]);
      const ap = await accountProducts(created.id);
      assert.equal(ap.trials.connect.state, "available", `door ${door}: connect stays available`);
    }
    // The Google path (a new account from the sales door, dispatch on).
    const jar = (m: Record<string, string>) => ({
      get: (n: string) => (n in m ? { value: m[n] } : undefined),
      delete: (n: string) => {
        delete m[n];
      },
    });
    await withEnv({ CAMPAIGN_DISPATCH: "on" }, () =>
      googleSignIn({ account: { provider: "google" }, profile: { email: "g-sales@trials.example.test", name: "Mock" } }, jar({ signup_plan: "premium", signup_locale: "en", signup_door: "sales" })),
    );
    const [gu] = await rows<{ id: string; products: unknown }>(sql`SELECT id, products FROM users WHERE email = 'g-sales@trials.example.test'`);
    assert.deepEqual(gu.products, { base: "reception_multi", addons: [] }, "Google sign-up: base reception_multi");
    assert.deepEqual((await rows<{ product: string }>(sql`SELECT product FROM account_product_trials WHERE user_id = ${gu.id}`)).map((r) => r.product), ["sales"]);
    await googleSignIn({ account: { provider: "google" }, profile: { email: "g-conn@trials.example.test", name: "Mock" } }, jar({ signup_plan: "premium", signup_door: "connect" }));
    const [gc] = await rows<{ id: string; products: unknown }>(sql`SELECT id, products FROM users WHERE email = 'g-conn@trials.example.test'`);
    assert.deepEqual(gc.products, { base: "reception_multi", addons: [] });
    assert.equal(await trialRows(gc.id), 0, "Google connect door: no trial row");

    // Existing accounts: a login (and a sign-up attempt on an existing
    // email) writes nothing, whatever the door cookie and the flags.
    await db.execute(sql`INSERT INTO users (id, email, password_hash, role, subscription_plan, subscription_status, email_verified)
      VALUES (${id(0x20)}, 'old@trials.example.test', '', 'user', 'premium', 'active', true)`);
    const snap = () => rows<Record<string, unknown>>(sql`SELECT xmin::text AS x, products, door FROM users WHERE email = 'old@trials.example.test'`);
    const before = JSON.stringify(await snap());
    await withEnv({ CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" }, async () => {
      assert.equal(await googleSignIn({ account: { provider: "google" }, profile: { email: "old@trials.example.test" } }, jar({ signup_door: "sales" })), true, "login");
      assert.match(String(await googleSignIn({ account: { provider: "google" }, profile: { email: "old@trials.example.test" } }, jar({ signup_plan: "premium", signup_door: "sales" }))), /notice=exists/);
    });
    assert.equal(JSON.stringify(await snap()), before, "an existing account's row is not rewritten (xmin, products NULL, door)");
    assert.equal(await trialRows(id(0x20)), 0, "an existing account gets no trial row");
  }
  console.log("ok: sign-up — every door base reception_multi; sales trial only when startable; connect never; login writes nothing");

  // ── 4b. Sign-up through a not-yet-open door records its notify-me row ──
  {
    const { emailSignupAction } = await import("../../lib/auth/email-signup-action");
    const { signupDeps } = await import("../../lib/verification-limits/deps");
    const { signupWithEmail } = await import("../../lib/verification-limits/signup");
    const { recordNotifyRequest } = await import("../../lib/product-notify");
    const notifyOf = async (email: string) =>
      (await rows<{ product: string }>(sql`SELECT n.product FROM product_notify_requests n JOIN users u ON u.id = n.user_id WHERE u.email = ${email} ORDER BY n.product`)).map((r) => r.product);
    const userCount = (email: string) => count(sql`SELECT count(*)::int AS n FROM users WHERE email = ${email}`);

    // Email sign-up through the real action; the mailer is injected (nothing sent).
    class Redirected extends Error {
      constructor(readonly url: string) {
        super(`redirect ${url}`);
      }
    }
    const sent: string[] = [];
    const signupD = { ...signupDeps, send: async (to: string) => (sent.push(to), { ok: true }), log: async () => {} };
    let ipN = 40;
    const emailSignup = (email: string, door: string) => {
      const f = new FormData();
      f.set("email", email);
      f.set("password", "longenough");
      f.set("door", door);
      return emailSignupAction(f, { locale: "en", ip: `203.0.113.${ipN++}` }, {
        signup: (input) => signupWithEmail(input, signupD),
        signIn: async () => {
          throw new Redirected("/verify-email");
        },
        authErrorType: () => null,
        redirect: (u) => {
          throw new Redirected(u);
        },
      }).then(
        () => "<no redirect>",
        (e) => {
          if (e instanceof Redirected) return e.url;
          throw e;
        },
      );
    };
    const jar = (m: Record<string, string>) => ({
      get: (n: string) => (n in m ? { value: m[n] } : undefined),
      delete: (n: string) => {
        delete m[n];
      },
    });
    const googleSignup = (email: string, door: string) =>
      googleSignIn({ account: { provider: "google" }, profile: { email, name: "Mock" } }, jar({ signup_plan: "premium", signup_locale: "fr", signup_door: door }));

    // Gate off (no product flag in the env): sales / connect → one row each; reception → none.
    for (const [door, want] of [["sales", ["sales"]], ["connect", ["connect"]], ["reception", []]] as const) {
      const e = `n-email-${door}@trials.example.test`;
      assert.equal(await emailSignup(e, door), "/verify-email", `email sign-up via ${door}`);
      assert.deepEqual(await notifyOf(e), want, `email sign-up via ${door}, gate off`);
      const gm = `n-google-${door}@trials.example.test`;
      assert.equal(await googleSignup(gm, door), true, `Google sign-up via ${door}`);
      assert.deepEqual(await notifyOf(gm), want, `Google sign-up via ${door}, gate off`);
    }
    // Gate on (the public `available` is true): nothing recorded.
    await withEnv({ CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" }, async () => {
      for (const door of ["sales", "connect"]) {
        const e = `n-on-email-${door}@trials.example.test`;
        assert.equal(await emailSignup(e, door), "/verify-email");
        assert.deepEqual(await notifyOf(e), [], `email sign-up via ${door}, gate on`);
        const gm = `n-on-google-${door}@trials.example.test`;
        assert.equal(await googleSignup(gm, door), true);
        assert.deepEqual(await notifyOf(gm), [], `Google sign-up via ${door}, gate on`);
      }
    });
    // Sales open but connect not: only the closed door records.
    await withEnv({ CAMPAIGN_DISPATCH: "on" }, async () => {
      assert.equal(await googleSignup("n-mixed-sales@trials.example.test", "sales"), true);
      assert.deepEqual(await notifyOf("n-mixed-sales@trials.example.test"), []);
      assert.equal(await googleSignup("n-mixed-conn@trials.example.test", "connect"), true);
      assert.deepEqual(await notifyOf("n-mixed-conn@trials.example.test"), ["connect"]);
    });
    assert.equal(sent.length, 5, "one (injected) verification email per created email account");

    // An EXISTING account through the Google door cookie: nothing written.
    await db.execute(sql`INSERT INTO users (id, email, password_hash, role, subscription_plan, subscription_status, email_verified)
      VALUES (${id(0x21)}, 'old-n@trials.example.test', '', 'user', 'premium', 'active', true)`);
    const snap = () => rows<Record<string, unknown>>(sql`SELECT xmin::text AS x, products, door FROM users WHERE email = 'old-n@trials.example.test'`);
    const before = JSON.stringify(await snap());
    for (const door of ["sales", "connect"]) {
      assert.equal(await googleSignIn({ account: { provider: "google" }, profile: { email: "old-n@trials.example.test" } }, jar({ signup_door: door })), true, "login");
      assert.match(String(await googleSignup("old-n@trials.example.test", door)), /notice=exists/);
      assert.match(await emailSignup("old-n@trials.example.test", door), /error=exists/);
    }
    assert.equal(JSON.stringify(await snap()), before, "the existing account's row is untouched");
    assert.deepEqual(await notifyOf("old-n@trials.example.test"), [], "the existing account gets no notify row");

    // The record failing never fails the sign-up: the real write breaks (table renamed) …
    await db.execute(sql`ALTER TABLE product_notify_requests RENAME TO product_notify_requests_off`);
    const errs: string[] = [];
    const origErr = console.error;
    console.error = (...a: unknown[]) => void errs.push(a.map(String).join(" "));
    try {
      assert.equal(await googleSignup("n-fail-google@trials.example.test", "sales"), true, "Google sign-up succeeds");
      assert.equal(await emailSignup("n-fail-email@trials.example.test", "connect"), "/verify-email", "email sign-up succeeds");
    } finally {
      console.error = origErr;
      await db.execute(sql`ALTER TABLE product_notify_requests_off RENAME TO product_notify_requests`);
    }
    for (const e of ["n-fail-google@trials.example.test", "n-fail-email@trials.example.test"]) {
      assert.equal(await userCount(e), 1, `${e}: account created`);
      assert.deepEqual(await notifyOf(e), [], `${e}: no row`);
    }
    const failLogs = errs.filter((l) => l.includes("signup notify record failed"));
    assert.equal(failLogs.length, 2, "one log line per failed record");
    for (const l of failLogs) assert.doesNotMatch(l, /@|trials\.example|product_notify/, "error class only, no PII or query text");
    // … and through the seam (a writer that throws).
    const viaSeam = await provisionTenant(
      { email: "n-seam@trials.example.test", displayName: "Mock", plan: "premium", locale: "fr", emailVerified: false, passwordHash: "x", door: "sales" },
      {
        env: {},
        recordNotify: async () => {
          throw new TypeError("mock failure");
        },
      },
    ).catch(() => null);
    assert.ok(viaSeam, "provisionTenant returns the account when the writer throws");
    assert.equal(await userCount("n-seam@trials.example.test"), 1);

    // Races: a double creation of the same email → one account, one row;
    // a concurrent re-record for that account stays one row.
    const race = await Promise.allSettled(
      [0, 1, 2].map(() =>
        provisionTenant({ email: "n-race@trials.example.test", displayName: "Mock", plan: "premium", locale: "fr", emailVerified: false, passwordHash: "x", door: "sales" }, { env: {} }),
      ),
    );
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1, "one creation wins (unique email)");
    assert.equal(await userCount("n-race@trials.example.test"), 1);
    const [winner] = await rows<{ id: string }>(sql`SELECT id FROM users WHERE email = 'n-race@trials.example.test'`);
    const again = await Promise.all([0, 1, 2, 3].map(() => recordNotifyRequest(winner.id, "sales")));
    assert.equal(again.filter((r) => r.created).length, 0, "the row already existed from the creation");
    assert.equal(await count(sql`SELECT count(*)::int AS n FROM product_notify_requests WHERE user_id = ${winner.id}`), 1, "exactly one row");
  }
  console.log("ok: sign-up via a closed sales / connect door records one notify row (email + Google); reception, gate on, existing accounts: none; fail-open; races: one row");

  // ── 5. The sales trial cap in the dispatcher ───────────────────────────
  {
    const WINDOW = JSON.stringify({ timezone: "UTC", days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24, respectDnc: false });
    const camp = (n: number) => id(0x300 + n);
    const contact = (n: number, k: number) => id(0x400 + n * 16 + k);
    const accounts = [GF, PAID, TRIALONLY];
    for (const [n, uid] of accounts.entries()) {
      await db.execute(sql`INSERT INTO campaigns (id, user_id, name, status, from_number, concurrency, call_window)
        VALUES (${camp(n)}, ${uid}, 'Mock campaign', 'running', '+15550000300', 2, ${WINDOW}::jsonb)`);
      for (const k of [0, 1]) {
        await db.execute(sql`INSERT INTO campaign_contacts (id, campaign_id, user_id, phone_number, contact_name, status, created_at)
          VALUES (${contact(n, k)}, ${camp(n)}, ${uid}, ${`+1555000040${n}${k}`}, 'Mock Contact', 'queued', now() - ${`${10 - k} minutes`}::interval)`);
      }
    }
    const ON = { CAMPAIGN_DISPATCH: "on" };
    const reset = async () => {
      await db.execute(sql`UPDATE campaign_contacts SET status = 'queued', claimed_at = NULL, attempts = 0, call_state = '', call_state_at = NULL WHERE campaign_id IN (${camp(0)}, ${camp(1)}, ${camp(2)})`);
      await db.execute(sql`DELETE FROM events WHERE event IN ('campaign_dial', 'campaign_dial_skipped', 'dispatch_tick', 'campaign_dial_failed')`);
      g.__campgateDials = [];
    };
    const state = async () => ({
      contacts: await rows(sql`SELECT id, status, attempts, call_state FROM campaign_contacts WHERE campaign_id IN (${camp(0)}, ${camp(1)}, ${camp(2)}) ORDER BY id`),
      events: await rows(sql`SELECT user_id, event, level, message, metadata FROM events WHERE event IN ('campaign_dial', 'campaign_dial_skipped', 'dispatch_tick', 'campaign_dial_failed') ORDER BY user_id, event, message, metadata::text`),
      dials: [...(g.__campgateDials ?? [])].sort((a, b) => String(a.roomName).localeCompare(String(b.roomName))),
    });
    const run = async () => {
      await reset();
      const result = await dispatchDueJobs(50, "cron", { env: ON });
      return JSON.stringify({ result, ...(await state()) });
    };
    const only = (s: string, uid: string) => {
      const o = JSON.parse(s) as { contacts: Array<{ id: string }>; events: Array<{ user_id: string }>; dials: Array<{ userId: string }> };
      const mine = new Set([0, 1].map((k) => contact(accounts.indexOf(uid), k)));
      return JSON.stringify({ c: o.contacts.filter((c) => mine.has(c.id)), e: o.events.filter((e) => e.user_id === uid), d: o.dials.filter((d) => d.userId === uid) });
    };

    // (a) No trial rows anywhere: everyone dials.
    const noTrial = await run();
    const a = JSON.parse(noTrial) as { result: { claimed: number; dialed: number }; dials: unknown[] };
    assert.deepEqual([a.result.claimed, a.result.dialed, a.dials.length], [6, 6, 6], "no trial rows: 6 dials");

    // (b) Exhausted + ended sales trial rows on the paid and grandfathered
    //     accounts: their dispatch is byte-identical (entitled without trial).
    for (const uid of [GF, PAID]) {
      await db.execute(sql`INSERT INTO account_product_trials (user_id, product, started_at, ends_at, minutes_included)
        VALUES (${uid}, 'sales', now() - interval '30 days', now() - interval '23 days', 30)`);
      await db.execute(sql`INSERT INTO campaign_calls (campaign_id, contact_id, user_id, phone_number, duration_seconds) VALUES (${camp(accounts.indexOf(uid))}, ${contact(accounts.indexOf(uid), 0)}, ${uid}, '+15550000499', 99999)`);
    }
    const paidWithTrial = await run();
    // The campaign_calls rows are not read by the dispatcher for them: the
    // whole run (result, contacts, events, dials) is byte-identical.
    assert.equal(paidWithTrial, noTrial, "paid / grandfathered: byte-identical with an exhausted trial row");

    // (c) The trial-only account, active and under the cap: dials as before.
    await db.execute(sql`INSERT INTO account_product_trials (user_id, product, started_at, ends_at, minutes_included)
      VALUES (${TRIALONLY}, 'sales', now() - interval '1 day', now() + interval '6 days', 30)`);
    await db.execute(sql`INSERT INTO campaign_calls (campaign_id, contact_id, user_id, phone_number, duration_seconds, created_at) VALUES
      (${camp(2)}, ${contact(2, 0)}, ${TRIALONLY}, '+15550000498', 1799, now()),
      (${camp(2)}, ${contact(2, 0)}, ${TRIALONLY}, '+15550000497', 5000, now() - interval '2 days')`);
    const under = await run();
    assert.equal(only(under, TRIALONLY), only(noTrial, TRIALONLY), "trial-only, under the cap (1799 s; older seconds not counted): identical");
    assert.equal(under, noTrial, "whole run identical");

    // (d) The cap is reached (1800 s): no dial, contacts queued, attempts
    //     given back, ONE event without PII; the others unchanged.
    await db.execute(sql`INSERT INTO campaign_calls (campaign_id, contact_id, user_id, phone_number, duration_seconds, created_at) VALUES (${camp(2)}, ${contact(2, 0)}, ${TRIALONLY}, '+15550000496', 1, now())`);
    const capped = await run();
    for (const uid of [GF, PAID]) assert.equal(only(capped, uid), only(noTrial, uid), `capped run: ${uid} unchanged`);
    const c = JSON.parse(capped) as {
      result: { claimed: number; dialed: number; failed: number };
      contacts: Array<{ id: string; status: string; attempts: number }>;
      events: Array<{ user_id: string; event: string; message: string; metadata: Record<string, unknown> }>;
      dials: Array<{ userId: string }>;
    };
    assert.deepEqual(c.result, { claimed: 6, dialed: 4, failed: 0 });
    assert.equal(c.dials.filter((d) => d.userId === TRIALONLY).length, 0, "no dial for the capped account");
    for (const k of [0, 1]) {
      const row = c.contacts.find((x) => x.id === contact(2, k))!;
      assert.deepEqual([row.status, row.attempts], ["queued", 0], "contact queued, attempt given back");
    }
    const skipped = c.events.filter((e) => e.event === "campaign_dial_skipped");
    assert.equal(skipped.length, 1, "one skip event per account per tick");
    assert.equal(skipped[0].user_id, TRIALONLY);
    assert.equal(skipped[0].metadata.reason, "sales_trial_minutes_used");
    assert.ok(!JSON.stringify(skipped).includes("+1555") && !JSON.stringify(skipped).includes("Mock Contact"), "no PII in the event");

    // (e) The trial ended (minutes unused): refused, sales_trial_ended.
    await db.execute(sql`DELETE FROM campaign_calls WHERE user_id = ${TRIALONLY}`);
    await db.execute(sql`UPDATE account_product_trials SET started_at = now() - interval '8 days', ends_at = now() - interval '1 second' WHERE user_id = ${TRIALONLY}`);
    const ended = JSON.parse(await run()) as typeof c;
    assert.equal(ended.dials.filter((d) => d.userId === TRIALONLY).length, 0);
    assert.equal(ended.events.find((e) => e.event === "campaign_dial_skipped")?.metadata.reason, "sales_trial_ended");

    // (f) The same account once it pays for sales: dials again, identical.
    await db.execute(sql`UPDATE users SET products = ${JSON.stringify({ base: "reception_multi", addons: ["sales"] })}::jsonb WHERE id = ${TRIALONLY}`);
    assert.equal(await run(), noTrial, "paid after the trial: identical to no trial");
    await db.execute(sql`UPDATE users SET products = ${MULTI}::jsonb WHERE id = ${TRIALONLY}`);

    // Dispatch off: nothing at all, trial or not.
    await reset();
    const off = await dispatchDueJobs(50, "cron", { env: {} });
    assert.equal((off as { mode?: string }).mode, "off");
    assert.equal((g.__campgateDials ?? []).length, 0);
  }
  console.log("ok: dispatcher — paid / grandfathered byte-identical with an exhausted trial row; trial-only dials under the cap, refused at 30 min or at ends_at");

  // ── 6. The inbound trial gate (call answering) is unchanged ────────────
  {
    const gate = async (uid: string) => {
      const [u] = await rows<{ id: string; subscriptionStatus: string; trialEndsAt: Date | null; role: string }>(
        sql`SELECT id, subscription_status AS "subscriptionStatus", trial_ends_at AS "trialEndsAt", role FROM users WHERE id = ${uid}`,
      );
      return JSON.stringify(await inboundTrialRefusal({ ...u, trialEndsAt: u.trialEndsAt ? new Date(u.trialEndsAt) : null }));
    };
    await db.execute(sql`INSERT INTO calls (user_id, from_number, to_number, duration_seconds) VALUES (${OTHER}, '+15550000501', '+15550000502', 7000)`);
    const before = [await gate(OTHER), await gate(TENANT)];
    assert.equal(before[0], JSON.stringify({ trialSecondsUsed: 7000, cause: "minutes" }), "the sign-up trial (100 min) still refuses past its minutes");
    await db.execute(sql`DELETE FROM account_product_trials WHERE user_id IN (${OTHER}, ${TENANT})`);
    assert.deepEqual([await gate(OTHER), await gate(TENANT)], before, "trial rows change nothing at call answering");
    await db.execute(sql`INSERT INTO account_product_trials (user_id, product, ends_at, minutes_included) VALUES
      (${OTHER}, 'reception', now() + interval '7 days', 30), (${OTHER}, 'connect', now() + interval '7 days', 30), (${TENANT}, 'sales', now() + interval '7 days', 30)`);
    assert.deepEqual([await gate(OTHER), await gate(TENANT)], before, "active trial rows change nothing at call answering");
  }
  console.log("ok: inbound trial gate unchanged by per-product trial rows");

  // ── 7. billing-stats: usageByProduct.trials (record-holder, additive) ──
  {
    as(ADMIN);
    const stats = async (uid: string) => {
      const res = await billing.GET(new NextRequest(`http://localhost/api/dashboard/billing-stats?asUserId=${uid}`));
      assert.equal(res.status, 200);
      return JSON.parse(await res.text()) as Record<string, unknown> & { usageByProduct?: { trials?: Array<Record<string, unknown>> } };
    };
    const withTrials = await stats(TENANT);
    const trials = withTrials.usageByProduct?.trials ?? [];
    assert.equal(trials.length, 1);
    assert.deepEqual([trials[0].product, trials[0].entry, trials[0].state, trials[0].minutesIncluded, trials[0].usedSeconds], ["sales", "sales", "active", 30, 0]);
    await db.execute(sql`DELETE FROM account_product_trials WHERE user_id = ${TENANT}`);
    const without = await stats(TENANT);
    assert.ok(!("trials" in (without.usageByProduct ?? {})), "no trial row → no trials key");
    delete (withTrials.usageByProduct as Record<string, unknown>).trials;
    assert.deepEqual(withTrials, without, "otherwise identical (additive)");
    const gf = await stats(GF);
    assert.ok(!("usageByProduct" in gf), "grandfathered: still no usageByProduct");
  }
  console.log("ok: billing-stats usageByProduct.trials additive; grandfathered unchanged");

  // ── 8. trials[entry].startable ⇔ the POST returns 201, every account ──
  {
    const { startProductTrial } = await import("../../lib/product-trials-start");
    const { TRIAL_PRODUCT_OF_ENTRY } = await import("../../lib/product-trial-decision");
    const { PRODUCT_ENTRIES } = await import("../../lib/product-values");
    const accounts = [...(await rows<{ id: string }>(sql`SELECT id FROM users ORDER BY id`)).map((r) => r.id), id(0xfff)];
    let created = 0;
    let checked = 0;
    // (a) Through the real route (enforced caps, process.env), as the admin.
    const envs: Array<Record<string, string>> = [{}, { CAMPAIGN_DISPATCH: "dry", CLIENT_AGENT: "admin" }, { CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" }];
    for (const env of envs) {
      await withEnv(env, async () => {
        for (const uid of accounts)
          for (const e of PRODUCT_ENTRIES) {
            const { startable } = (await accountProducts(uid)).trials[e];
            as(ADMIN);
            const r = await post({ product: TRIAL_PRODUCT_OF_ENTRY[e] }, uid === ADMIN ? "" : `?asUserId=${uid}`);
            assert.equal(r.status === 201, startable, `route ${uid} ${e} ${JSON.stringify(env)}: startable ${startable}, POST ${r.status} ${String(r.body?.error ?? "")}`);
            if (r.status === 201) created++;
            checked++;
          }
      });
    }
    // (b) Every cap enforced (no product held back), through startProductTrial
    //     (the POST's core) with the same env and caps as accountProducts.
    const allCaps = { reception: true, reception_multi: true, sales: true, connect: true };
    const env = { CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" };
    for (const uid of accounts)
      for (const e of PRODUCT_ENTRIES) {
        const { startable } = (await accountProducts(uid, new Date(), { env, caps: allCaps })).trials[e];
        const res = await startProductTrial(uid, TRIAL_PRODUCT_OF_ENTRY[e], { env, caps: allCaps });
        assert.equal(res.ok, startable, `caps on ${uid} ${e}: startable ${startable}, start ${res.ok ? "ok" : res.code}`);
        if (res.ok) created++;
        checked++;
        // Once started (or refused), it is no longer startable.
        assert.equal((await accountProducts(uid, new Date(), { env, caps: allCaps })).trials[e].startable, false, `after ${uid} ${e}`);
      }
    assert.ok(created > 0, "some starts were accepted");
    console.log(`ok: startable ⇔ POST 201 on ${accounts.length} accounts, ${checked} checks (${created} created)`);
  }

  console.log("ALL PRODUCT-TRIALS DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
