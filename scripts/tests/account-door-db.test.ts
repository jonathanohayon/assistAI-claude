// The account's door against a THROWAWAY Postgres, through the real code:
// the CHECK constraint, the email sign-up action (hidden field → users.door),
// the Google signIn callback (injected cookie store; Google is never called)
// and the four gate cases of PUT /api/dashboard/account, for the tenant and
// for the admin via ?asUserId=. The session is a test double (module hooks,
// scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs); nothing is sent.
// Plain `npm test` skips it. Run it with:  bash scripts/account-door-db.sh
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read
// from the shell. Mock data only (example.test, documentation IP ranges).
// Only dynamic imports after the env checks.

import assert from "node:assert/strict";

const url = process.env.ACCOUNT_DOOR_DB_TEST_URL;
if (!url) {
  console.log("skip: account-door DB part (no ACCOUNT_DOOR_DB_TEST_URL — see scripts/account-door-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /^(LIVEKIT|TWILIO|RESEND|WHATSAPP|GOOGLE)|OPENAI|REALTIME_API_KEY|EMAIL_FROM/i.test(k))) {
  throw new Error("refusing to run with provider env set");
}
if (!(globalThis as { __campgateHooks?: boolean }).__campgateHooks) throw new Error("module hooks missing: run through scripts/account-door-db.sh");
process.env.DATABASE_URL = url;

const g = globalThis as { __campgateSession?: { user: { id: string } } | null };
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ADMIN = id(0xad);
const T1 = id(0x71);
const T2 = id(0x72);

class Redirected extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { GET, PUT } = await import("../../app/api/dashboard/account/route");
  const { emailSignupAction } = await import("../../lib/auth/email-signup-action");
  const { googleSignIn } = await import("../../lib/auth/google-sign-in");
  const { getAccountDoor } = await import("../../lib/door");
  const { TRIAL_PLAN_KEY } = await import("../../lib/plans");
  const { signupDeps } = await import("../../lib/verification-limits/deps");
  const { signupWithEmail } = await import("../../lib/verification-limits/signup");

  type Row = Record<string, unknown>;
  const rows = async (q: ReturnType<typeof sql>) => {
    const r = (await db.execute(q)) as unknown as Row[] | { rows: Row[] };
    return Array.isArray(r) ? r : r.rows;
  };
  const doorOf = async (where: ReturnType<typeof sql>) => {
    const [r] = await rows(sql`SELECT door FROM users WHERE ${where}`);
    return r ? r.door : "<no row>";
  };
  const reset = async () => {
    await db.execute(sql`DELETE FROM app_settings WHERE key LIKE 'rate_limit:%'`);
    await db.execute(sql`DELETE FROM users WHERE email LIKE '%@door.example.test'`);
    await db.execute(sql`INSERT INTO users (id, email, password_hash, role) VALUES
      (${ADMIN}, 'admin@door.example.test', 'x', 'admin'),
      (${T1}, 't1@door.example.test', 'x', 'user'),
      (${T2}, 't2@door.example.test', 'x', 'user')`);
  };
  await reset();

  // ── 1. The CHECK rejects any other value ───────────────────────────────
  for (const bad of ["admin", "Sales", "", "reception "]) {
    await assert.rejects(
      db.execute(sql`UPDATE users SET door = ${bad} WHERE id = ${T1}`),
      (e: unknown) => {
        const err = e as { code?: string; cause?: { code?: string } };
        return (err.code ?? err.cause?.code) === "23514";
      },
      `CHECK rejects ${JSON.stringify(bad)}`,
    );
  }
  for (const ok of ["reception", "sales", "connect"]) {
    await db.execute(sql`UPDATE users SET door = ${ok} WHERE id = ${T1}`);
    assert.equal(await doorOf(sql`id = ${T1}`), ok);
  }
  await db.execute(sql`UPDATE users SET door = NULL WHERE id = ${T1}`);
  assert.equal(await getAccountDoor(T1), "reception", "NULL reads as reception");
  assert.equal(await getAccountDoor(id(0xfff)), "reception", "unknown account reads as reception");
  console.log("ok: CHECK rejects other values; NULL = reception");

  // ── 2. Email sign-up stores the door (hidden field → users.door) ───────
  const sent: string[] = [];
  const signupD = { ...signupDeps, send: async (to: string) => (sent.push(to), { ok: true }), log: async () => {} };
  const action = (fields: Record<string, string>, ip: string) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return emailSignupAction(f, { locale: "en", ip }, {
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
  assert.equal(await action({ email: "sales@door.example.test", password: "longenough", door: "sales" }, "203.0.113.31"), "/verify-email");
  assert.equal(await doorOf(sql`email = 'sales@door.example.test'`), "sales");
  assert.equal(await action({ email: "connect@door.example.test", password: "longenough", door: " CONNECT " }, "203.0.113.32"), "/verify-email");
  assert.equal(await doorOf(sql`email = 'connect@door.example.test'`), "connect");
  assert.equal(await action({ email: "plain@door.example.test", password: "longenough" }, "203.0.113.33"), "/verify-email");
  assert.equal(await doorOf(sql`email = 'plain@door.example.test'`), "reception", "no door field → reception");
  assert.equal(await action({ email: "junk@door.example.test", password: "longenough", door: "admin" }, "203.0.113.34"), "/verify-email");
  assert.equal(await doorOf(sql`email = 'junk@door.example.test'`), "reception", "junk door → reception");
  // Errors bounce back to /signup with the door and never touch an existing door.
  assert.equal(
    await action({ email: "sales@door.example.test", password: "longenough", door: "connect" }, "203.0.113.35"),
    "/en/signup?error=exists&door=connect",
  );
  assert.equal(await doorOf(sql`email = 'sales@door.example.test'`), "sales", "an existing account's door is unchanged");
  assert.equal(await action({ email: "short@door.example.test", password: "short", door: "sales" }, "203.0.113.36"), "/en/signup?error=invalid&door=sales");
  assert.equal(await doorOf(sql`email = 'short@door.example.test'`), "<no row>");
  assert.equal(sent.length, 4, "one verification email per created account");
  console.log("ok: email sign-up stores the door; errors keep it in the redirect");

  // ── 3. Google signIn callback: door on a NEW account only ──────────────
  const jar = (init: Record<string, string>) => {
    const m = new Map(Object.entries(init));
    const deleted: string[] = [];
    return {
      store: {
        get: (n: string) => (m.has(n) ? { value: m.get(n)! } : undefined),
        delete: (n: string) => {
          deleted.push(n);
          m.delete(n);
        },
      },
      deleted,
      left: () => [...m.keys()],
    };
  };
  const google = { provider: "google" };
  const profile = (email: string) => ({ email, name: "Mock Google", email_verified: true });
  {
    const j = jar({ signup_plan: TRIAL_PLAN_KEY, signup_locale: "he", signup_door: "connect" });
    assert.equal(await googleSignIn({ account: google, profile: profile("g-new@door.example.test") }, j.store), true);
    const [u] = await rows(sql`SELECT door, locale, email_verified FROM users WHERE email = 'g-new@door.example.test'`);
    assert.deepEqual([u.door, u.locale, u.email_verified], ["connect", "he", true]);
    assert.deepEqual(j.deleted.sort(), ["signup_door", "signup_locale", "signup_plan"], "all three cookies consumed");
    assert.deepEqual(j.left(), []);
  }
  {
    const j = jar({ signup_plan: TRIAL_PLAN_KEY, signup_locale: "fr" });
    assert.equal(await googleSignIn({ account: google, profile: profile("g-nodoor@door.example.test") }, j.store), true);
    assert.equal(await doorOf(sql`email = 'g-nodoor@door.example.test'`), "reception", "no door cookie → reception");
  }
  {
    const j = jar({ signup_plan: TRIAL_PLAN_KEY, signup_door: "<script>" });
    assert.equal(await googleSignIn({ account: google, profile: profile("g-junk@door.example.test") }, j.store), true);
    assert.equal(await doorOf(sql`email = 'g-junk@door.example.test'`), "reception", "junk door cookie → reception");
  }
  // Existing account, LOGIN (no plan cookie; a stale door cookie): door unchanged.
  await db.execute(sql`UPDATE users SET door = 'sales' WHERE email = 'g-new@door.example.test'`);
  {
    const j = jar({ signup_door: "reception" });
    assert.equal(await googleSignIn({ account: google, profile: profile("g-new@door.example.test") }, j.store), true);
    assert.equal(await doorOf(sql`email = 'g-new@door.example.test'`), "sales", "a login never changes the door");
    assert.deepEqual(j.left(), [], "the stale door cookie is consumed too");
  }
  // Existing account, SIGN-UP intent: bounced to /login, door unchanged.
  {
    const j = jar({ signup_plan: TRIAL_PLAN_KEY, signup_locale: "en", signup_door: "connect" });
    assert.equal(await googleSignIn({ account: google, profile: profile("g-new@door.example.test") }, j.store), "/en/login?notice=exists");
    assert.equal(await doorOf(sql`email = 'g-new@door.example.test'`), "sales");
  }
  // An email-only existing account linked by Google login: door unchanged (NULL stays NULL).
  {
    const j = jar({});
    assert.equal(await googleSignIn({ account: google, profile: profile("t2@door.example.test") }, j.store), true);
    assert.equal(await doorOf(sql`id = ${T2}`), null);
  }
  // Credentials sign-ins pass straight through and read no cookie.
  {
    const j = jar({ signup_door: "connect" });
    assert.equal(await googleSignIn({ account: { provider: "credentials" }, profile: null }, j.store), true);
    assert.deepEqual(j.left(), ["signup_door"]);
  }
  console.log("ok: Google callback stores the door for a new account, never on an existing one");

  // ── 4. PUT /api/dashboard/account: the four gate cases ─────────────────
  await reset();
  await db.execute(sql`UPDATE users SET door = 'connect' WHERE id = ${T2}`);
  const call = async (as: string | null, method: "GET" | "PUT", body?: unknown, asUserId?: string) => {
    g.__campgateSession = as ? { user: { id: as } } : null;
    const q = asUserId ? `?asUserId=${asUserId}` : "";
    const req = new NextRequest(`http://localhost/api/dashboard/account${q}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    // The handlers' inferred type includes undefined (the scope helper's union).
    const res = (method === "GET" ? await GET(req) : await PUT(req))!;
    return { status: res.status, body: await res.json() };
  };
  const stored = async (uid: string) => {
    const [r] = await rows(sql`SELECT developer_mode, door FROM users WHERE id = ${uid}`);
    return { developerMode: r.developer_mode, door: r.door };
  };

  // GET resolves NULL.
  assert.deepEqual(await call(T1, "GET"), { status: 200, body: { developerMode: false, door: "reception" } });
  assert.deepEqual(await call(null, "GET"), { status: 401, body: { error: "Unauthorized" } });
  assert.deepEqual(await call(null, "PUT", { door: "sales" }), { status: 401, body: { error: "Unauthorized" } });

  const gateCases = async (label: string, actor: string, target: string, asUserId: string | undefined, other: string) => {
    const before = await stored(target);
    // (1) a valid value is stored
    assert.deepEqual(await call(actor, "PUT", { door: "sales" }, asUserId), { status: 200, body: { developerMode: before.developerMode, door: "sales" } }, `${label} (1)`);
    assert.deepEqual(await stored(target), { ...before, door: "sales" }, `${label} (1) stored`);
    assert.deepEqual(await call(actor, "GET", undefined, asUserId), { status: 200, body: { developerMode: before.developerMode, door: "sales" } });
    // (2) invalid → 400, unchanged
    for (const bad of ["admin", "", null, 7, ["connect"]]) {
      assert.deepEqual(await call(actor, "PUT", { door: bad }, asUserId), { status: 400, body: { error: "invalid_door" } }, `${label} (2) ${JSON.stringify(bad)}`);
      assert.deepEqual(await call(actor, "PUT", { developerMode: true, door: bad }, asUserId), { status: 400, body: { error: "invalid_door" } });
    }
    assert.deepEqual(await stored(target), { ...before, door: "sales" }, `${label} (2) unchanged`);
    // Empty / junk bodies keep today's error, unchanged.
    for (const junk of [{}, "not json", { developerMode: "yes" }]) {
      assert.deepEqual(await call(actor, "PUT", junk, asUserId), { status: 400, body: { error: "invalid_developer_mode" } }, `${label} junk`);
    }
    assert.deepEqual(await stored(target), { ...before, door: "sales" });
    // (3) another tenant's asUserId as a non-admin → 403, unchanged
    const otherBefore = await stored(other);
    const targetBefore = await stored(target);
    assert.deepEqual(await call(T1 === other ? T2 : T1, "PUT", { door: "reception" }, other), { status: 403, body: { error: "Forbidden" } }, `${label} (3)`);
    assert.deepEqual(await call(T1 === other ? T2 : T1, "GET", undefined, other), { status: 403, body: { error: "Forbidden" } });
    assert.deepEqual(await stored(other), otherBefore, `${label} (3) other unchanged`);
    assert.deepEqual(await stored(target), targetBefore, `${label} (3) target unchanged`);
    // (4) omitting door keeps the stored value (developerMode-only body)
    assert.deepEqual(await call(actor, "PUT", { developerMode: true }, asUserId), { status: 200, body: { developerMode: true, door: "sales" } }, `${label} (4)`);
    assert.deepEqual(await stored(target), { developerMode: true, door: "sales" }, `${label} (4) door kept`);
    assert.deepEqual(await call(actor, "PUT", { developerMode: false }, asUserId), { status: 200, body: { developerMode: false, door: "sales" } });
    // …and omitting developerMode keeps the flag (door-only body).
    await call(actor, "PUT", { developerMode: true }, asUserId);
    assert.deepEqual(await call(actor, "PUT", { door: "connect" }, asUserId), { status: 200, body: { developerMode: true, door: "connect" } });
    assert.deepEqual(await stored(target), { developerMode: true, door: "connect" });
  };
  await gateCases("tenant", T1, T1, undefined, T2);
  await gateCases("admin as T2", ADMIN, T2, T2, T1);
  // The admin's own door was never touched by the asUserId writes.
  assert.deepEqual(await stored(ADMIN), { developerMode: false, door: null });
  console.log("ok: PUT gate cases (valid, invalid, foreign asUserId, omitted) for tenant and admin");

  await db.execute(sql`DELETE FROM users WHERE email LIKE '%@door.example.test'`);
  console.log("ALL ACCOUNT-DOOR DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
