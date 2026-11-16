// The account's door (lib/door.ts, lib/door-values.ts, migration 0054):
// parsing, the sign-up redirects that must keep it, the partial PUT body of
// /api/dashboard/account, and static guards on the wiring. The real-DB side
// (CHECK, sign-up rows, the Google callback, the PUT gates) is in
// scripts/tests/account-door-db.test.ts.
// Run with:  npx tsx scripts/tests/account-door.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { accountUpdateSet, parseAccountBody } from "../../lib/account-settings";
import { emailSignupAction, signupErrorPath, type EmailSignupActionDeps } from "../../lib/auth/email-signup-action";
import { users } from "../../lib/db/schema";
import { DEFAULT_DOOR, DOORS, doorQuery, parseDoor, resolveDoor, toDoor, withDoor, type Door } from "../../lib/door";
import type { SignupError, SignupOutcome } from "../../lib/verification-limits/signup";

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// ── Values ────────────────────────────────────────────────────────────────
assert.deepEqual([...DOORS], ["reception", "sales", "connect"]);
assert.equal(DEFAULT_DOOR, "reception");

// parseDoor: exact match to one of the three (trim + lower-case), else reception.
for (const d of DOORS) {
  assert.equal(parseDoor(d), d);
  assert.equal(parseDoor(` ${d.toUpperCase()} `), d, "trim + lower-case accepted");
}
for (const bad of [undefined, null, "", "  ", "sale", "sales!", "reception,sales", "connect ion", "SALES\u0000", 1, true, {}, ["sales"]]) {
  assert.equal(parseDoor(bad), "reception", `parseDoor(${JSON.stringify(bad)}) → reception`);
  assert.equal(toDoor(bad), null, `toDoor(${JSON.stringify(bad)}) → null`);
}

// resolveDoor: NULL (and anything unknown) reads as reception.
assert.equal(resolveDoor(null), "reception");
for (const d of DOORS) assert.equal(resolveDoor(d), d);
assert.equal(resolveDoor("legacy"), "reception");

// URL helpers: reception adds nothing (today's URLs unchanged).
assert.equal(doorQuery("reception"), "");
assert.equal(doorQuery("sales"), "door=sales");
assert.equal(withDoor("/fr/signup?error=exists", "reception"), "/fr/signup?error=exists");
assert.equal(withDoor("/fr/signup?error=exists", "connect"), "/fr/signup?error=exists&door=connect");
assert.equal(withDoor("/fr/signup", "sales"), "/fr/signup?door=sales");
console.log("door values: parseDoor, resolveDoor, URL helpers passed");

// ── Sign-up redirects keep the door ───────────────────────────────────────
const ERRORS: SignupError[] = ["invalid", "exists", "exists_google", "rate_limited"];
for (const locale of ["fr", "he", "en"]) {
  for (const error of ERRORS) {
    assert.equal(signupErrorPath(locale, error, "reception"), `/${locale}/signup?error=${error}`);
    for (const door of ["sales", "connect"] as Door[]) {
      assert.equal(signupErrorPath(locale, error, door), `/${locale}/signup?error=${error}&door=${door}`);
    }
  }
}

class Redirected extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}
class MockAuthError extends Error {
  constructor(readonly type: string) {
    super(type);
  }
}
function world(outcome: SignupOutcome, signInThrows: unknown = new Redirected("/verify-email")) {
  const seen: Array<{ door: Door; locale: string }> = [];
  const deps: EmailSignupActionDeps = {
    signup: async (input) => {
      seen.push({ door: input.door, locale: input.locale });
      return outcome;
    },
    signIn: async () => {
      throw signInThrows;
    },
    authErrorType: (e) => (e instanceof MockAuthError ? e.type : null),
    redirect: (url) => {
      throw new Redirected(url);
    },
  };
  return { deps, seen };
}
const form = (door?: string) => {
  const f = new FormData();
  f.set("email", "new@example.com");
  f.set("password", "longenough");
  if (door !== undefined) f.set("door", door);
  return f;
};
async function redirectOf(p: Promise<void>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Redirected) return e.url;
    throw e;
  }
  throw new Error("expected a redirect");
}

async function actionCases() {
  // Every error outcome bounces back to /signup WITH the door.
  for (const error of ERRORS) {
    for (const door of DOORS) {
      const w = world({ ok: false, error });
      const url = await redirectOf(emailSignupAction(form(door), { locale: "en", ip: "203.0.113.1" }, w.deps));
      assert.equal(url, signupErrorPath("en", error, door), `${error} keeps door ${door}`);
      assert.deepEqual(w.seen, [{ door, locale: "en" }], "the parsed door reaches the sign-up");
    }
  }
  // The hidden field is re-parsed server-side: junk/absent → reception, no param.
  for (const raw of [undefined, "", "admin", "sales<script>", "reception"]) {
    const w = world({ ok: false, error: "exists" });
    const url = await redirectOf(emailSignupAction(form(raw), { locale: "he", ip: "203.0.113.2" }, w.deps));
    assert.equal(url, "/he/signup?error=exists", `door ${JSON.stringify(raw)} → no door param`);
    assert.equal(w.seen[0].door, "reception");
  }
  // " SALES " from the form → sales.
  {
    const w = world({ ok: false, error: "invalid" });
    assert.equal(await redirectOf(emailSignupAction(form(" SALES "), { locale: "fr", ip: "203.0.113.3" }, w.deps)), "/fr/signup?error=invalid&door=sales");
  }
  // Success: the sign-in's own redirect (/verify-email) propagates untouched.
  {
    const w = world({ ok: true, email: "new@example.com", userId: "u1" });
    assert.equal(await redirectOf(emailSignupAction(form("connect"), { locale: "fr", ip: "203.0.113.4" }, w.deps)), "/verify-email");
    assert.equal(w.seen[0].door, "connect");
  }
  // A sign-in auth error after creation → /login?error=<type> (unchanged; the
  // door is already stored on the account).
  {
    const w = world({ ok: true, email: "new@example.com", userId: "u1" }, new MockAuthError("CredentialsSignin"));
    assert.equal(await redirectOf(emailSignupAction(form("sales"), { locale: "fr", ip: "203.0.113.5" }, w.deps)), "/login?error=CredentialsSignin");
  }
  // Any other error is rethrown as is.
  {
    const boom = new TypeError("mock failure");
    const w = world({ ok: true, email: "new@example.com", userId: "u1" }, boom);
    await assert.rejects(emailSignupAction(form("sales"), { locale: "fr", ip: "203.0.113.6" }, w.deps), (e) => e === boom);
  }
  console.log("sign-up redirects: every error keeps the door passed");
}

// ── PUT /api/dashboard/account body (partial) ─────────────────────────────
function bodyCases() {
  // developerMode-only bodies behave exactly as before.
  assert.deepEqual(parseAccountBody({ developerMode: true }), { ok: true, value: { developerMode: true } });
  assert.deepEqual(parseAccountBody({ developerMode: false }), { ok: true, value: { developerMode: false } });
  for (const bad of [null, {}, "x", [], { developerMode: "true" }, { developerMode: 1 }, { developerMode: null }]) {
    assert.deepEqual(parseAccountBody(bad), { ok: false, error: "invalid_developer_mode" }, JSON.stringify(bad));
  }
  // door only, both, invalid door.
  for (const d of DOORS) assert.deepEqual(parseAccountBody({ door: d }), { ok: true, value: { door: d } });
  assert.deepEqual(parseAccountBody({ developerMode: true, door: "connect" }), { ok: true, value: { developerMode: true, door: "connect" } });
  for (const bad of ["", "admin", null, 3, ["sales"]]) {
    assert.deepEqual(parseAccountBody({ door: bad }), { ok: false, error: "invalid_door" }, JSON.stringify(bad));
    assert.deepEqual(parseAccountBody({ developerMode: true, door: bad }), { ok: false, error: "invalid_door" });
  }
  assert.deepEqual(parseAccountBody({ door: "sales " }), { ok: true, value: { door: "sales" } });
  // Both invalid: the developerMode error comes first (as before).
  assert.deepEqual(parseAccountBody({ developerMode: "x", door: "x" }), { ok: false, error: "invalid_developer_mode" });

  // Gate case (4): the route's body→stored helper never writes an omitted key.
  const set = (raw: unknown) => {
    const p = parseAccountBody(raw);
    assert.ok(p.ok);
    return accountUpdateSet(p.value);
  };
  assert.deepEqual(set({ developerMode: true }), { developerMode: true });
  assert.ok(!("door" in set({ developerMode: false })), "omitting door keeps the stored door");
  assert.deepEqual(set({ door: "sales" }), { door: "sales" });
  assert.ok(!("developerMode" in set({ door: "connect" })), "omitting developerMode keeps the stored flag");
  assert.deepEqual(set({ developerMode: true, door: "connect" }), { developerMode: true, door: "connect" });
  console.log("account body: partial PUT, invalid_door, omitted keys passed");
}

// ── Static guards on the wiring ───────────────────────────────────────────
function wiring() {
  // Schema + migration: nullable text, CHECK, add-only migration.
  assert.equal(users.door.notNull, false, "users.door is nullable");
  assert.equal(users.door.hasDefault, false, "no default: NULL = reception at read time");
  const mig = readFileSync("drizzle/0054_account_door.sql", "utf8");
  assert.match(mig, /ADD COLUMN IF NOT EXISTS "door" text/);
  assert.match(mig, /CHECK \("users"\."door" IN \('reception', 'sales', 'connect'\)\)/);
  assert.match(mig, /EXCEPTION WHEN duplicate_object THEN NULL/, "the constraint is added idempotently");
  assert.doesNotMatch(mig, /\b(UPDATE|INSERT|DELETE|TRUNCATE|DROP)\b/i, "add-only: no data step");
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: Array<{ tag: string; when: number }> };
  const i = journal.entries.findIndex((e) => e.tag === "0054_account_door");
  assert.ok(i > 0, "0054 is in the journal");
  assert.ok(journal.entries.slice(0, i).every((e) => e.when < journal.entries[i].when), "0054 sorts after every earlier migration");

  // The client-safe module imports nothing.
  const values = code("lib/door-values.ts");
  assert.doesNotMatch(values, /\bimport\b|\brequire\(/, "lib/door-values.ts imports nothing");
  const content = code("app/[locale]/signup/signup-content.tsx");
  assert.match(content, /import type \{ Door \} from "@\/lib\/door-values"/, "the client file imports the type only");
  assert.doesNotMatch(content, /@\/lib\/door"/, "the client file never imports lib/door.ts (db)");
  assert.match(content, /<input type="hidden" name="door" value=\{door\} \/>/);

  // Page: the door from ?door=, the action, the Google cookie with the same options.
  const page = code("app/[locale]/signup/page.tsx");
  assert.match(page, /const door = parseDoor\(doorParam\)/);
  assert.match(page, /emailSignupAction\(formData, \{ locale, ip \}/);
  assert.doesNotMatch(page, /redirect\(`\/\$\{locale\}\/signup\?error=/, "every /signup error redirect goes through signupErrorPath");
  assert.match(page, /cookieStore\.set\("signup_plan", TRIAL_PLAN_KEY, opts\)/);
  assert.match(page, /cookieStore\.set\("signup_door", door, opts\)/);
  assert.match(page, /httpOnly: true,\s*sameSite: "lax" as const,\s*path: "\/",\s*maxAge: 600/);

  // Google callback: door cookie consumed with the others, applied on creation only.
  const g = code("lib/auth/google-sign-in.ts");
  assert.match(g, /SIGNUP_COOKIES = \["signup_plan", "signup_locale", "signup_door"\]/);
  assert.match(g, /const isSignupIntent = planCookie !== undefined;/, "signup_plan stays the intent marker");
  assert.equal((g.match(/door:/g) ?? []).length, 1, "the door is written in exactly one place (provisionTenant)");
  assert.match(g, /provisionTenant\(\{[\s\S]*door: parseDoor\(doorCookie\)/);
  assert.match(code("auth.ts"), /googleSignIn\(\{ account, profile \}, await cookies\(\)\)/);

  // Account route: GET/PUT return the resolved door; PUT writes through the helper.
  const route = code("app/api/dashboard/account/route.ts");
  assert.match(route, /resolveTargetUserId\(req\)/);
  assert.match(route, /\.set\(accountUpdateSet\(parsed\.value\)\)/);
  assert.equal((route.match(/door: resolveDoor\(u\.door\)/g) ?? []).length, 2);
  console.log("wiring passed");
}

async function main() {
  await actionCases();
  bodyCases();
  wiring();
  console.log("ALL ACCOUNT-DOOR TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
