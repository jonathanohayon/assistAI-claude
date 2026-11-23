// The trial-cleanup cron (app/api/cron/trial-cleanup) against a THROWAWAY
// Postgres, through the real route, with the e-mail senders and the number
// release INJECTED (lib/trial-cleanup-deps.ts): nothing is ever sent.
//   1. TRIAL_END_EMAIL off (unset, "off", anything else): the same response
//      and the same rows whatever the off value; an expired trial is paused
//      as before, minutes used up pause nothing, no paused e-mail.
//   2. On: expired -> paused + exactly one e-mail; minutes used up before the
//      end date -> paused (trial_ends_at moved to the pause) + one e-mail; a
//      re-run sends nothing more; concurrent runs send exactly one per
//      account; a send failure keeps the pause, logs the error class only and
//      is never resent.
//   3. A paid account (a paid payment order, any kind) is never e-mailed: the
//      selection excludes it, and the guard right before the send catches an
//      order paid during the run (warning and paused).
//   4. The warning: the real days left (0/1/2), skipped once the trial has
//      ended, deduped by trial_warning_sent_at.
//   5. Phase 3 (number release 30 days after trial_ends_at) is unchanged; for
//      a minutes pause the 30 days count from the pause.
// Mock data only (example.com, +1555). Run with:  bash scripts/trial-cleanup-db.sh
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read from
// the shell.

import assert from "node:assert/strict";

const url = process.env.TRIAL_CLEANUP_TEST_DB_URL;
if (!url) {
  console.log("skip: trial-cleanup-db (no TRIAL_CLEANUP_TEST_DB_URL — see scripts/trial-cleanup-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /RESEND|TWILIO|WHATSAPP|EMAIL_FROM/i.test(k))) {
  throw new Error("refusing to run with an e-mail or messaging provider env set");
}
process.env.DATABASE_URL = url;
process.env.INTERNAL_SECRET = "mock-internal-secret";

const H = 3_600_000;
const DAY = 24 * H;

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { trialCleanupDeps } = await import("../../lib/trial-cleanup-deps");
  const { trialWarningDays } = await import("../../lib/trial-end-email");
  const { GET } = await import("../../app/api/cron/trial-cleanup/route");

  // ─── Injected effects: count, never send ──────────────────────────────
  type WarnOpts = Parameters<typeof trialCleanupDeps.sendWarning>[1];
  type PausedOpts = Parameters<typeof trialCleanupDeps.sendPaused>[1];
  let warnings: Array<{ to: string; opts: WarnOpts }> = [];
  let pausedMails: Array<{ to: string; opts: PausedOpts }> = [];
  let releases: string[] = [];
  let onWarning: ((to: string) => Promise<void>) | null = null;
  let onPaused: ((to: string) => Promise<{ ok: boolean; error?: string } | "throw">) | null = null;
  trialCleanupDeps.sendWarning = async (to, opts) => {
    warnings.push({ to, opts });
    await onWarning?.(to);
    return { ok: true, id: "mock-id" };
  };
  trialCleanupDeps.sendPaused = async (to, opts) => {
    pausedMails.push({ to, opts });
    await new Promise((r) => setTimeout(r, 5)); // widen the race window
    const r = onPaused ? await onPaused(to) : { ok: true };
    if (r === "throw") throw new TypeError(`mock network failure for ${to}`);
    return r.ok ? { ok: true, id: "mock-id" } : { ok: false, error: r.error };
  };
  trialCleanupDeps.releaseNumbers = async (userId) => {
    releases.push(userId);
    return { releasedCount: 1, failedCount: 0, errors: [] };
  };

  // ─── Fixtures ──────────────────────────────────────────────────────────
  const T0 = Date.now();
  const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const emailOf = (n: number) => `trial-${n}@example.com`;
  async function reset() {
    await db.execute(sql`DELETE FROM events`);
    await db.execute(sql`DELETE FROM users WHERE email LIKE 'trial-%@example.com'`);
    warnings = [];
    pausedMails = [];
    releases = [];
    onWarning = null;
    onPaused = null;
  }
  async function mkUser(
    n: number,
    o: {
      status?: string;
      endsInMs?: number | null;
      role?: string;
      warned?: boolean;
      locale?: string;
      seconds?: number;
      paid?: boolean;
      phone?: boolean;
    },
  ) {
    const id = idOf(n);
    const ends = o.endsInMs === null ? null : new Date(T0 + (o.endsInMs ?? 5 * DAY));
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, role, subscription_status, trial_ends_at, trial_warning_sent_at, locale, created_at)
      VALUES (${id}, ${emailOf(n)}, 'mock-hash', ${o.role ?? "user"}, ${o.status ?? "trialing"},
              ${ends ? ends.toISOString() : null}::timestamptz,
              ${o.warned ? new Date(T0 - 3 * DAY).toISOString() : null}::timestamptz,
              ${o.locale ?? "fr"}, ${new Date(T0 - 10 * DAY).toISOString()}::timestamptz)`);
    if (o.seconds) await addCall(n, o.seconds);
    if (o.paid) await addPaidOrder(n);
    if (o.phone) {
      await db.execute(sql`INSERT INTO phone_numbers (user_id, phone_number) VALUES (${id}, ${`+1555000${String(n).padStart(4, "0")}`})`);
    }
    return id;
  }
  async function addCall(n: number, seconds: number) {
    await db.execute(sql`INSERT INTO calls (user_id, duration_seconds, created_at) VALUES (${idOf(n)}, ${seconds}, ${new Date(T0 - DAY).toISOString()}::timestamptz)`);
  }
  async function addPaidOrder(n: number, kind = "subscription", products: unknown = null) {
    await db.execute(sql`
      INSERT INTO payment_orders (user_id, plan_key, period, kind, currency, coin, expected_amount, status, expires_at, paid_at, created_at, products)
      VALUES (${idOf(n)}, 'basic', 'monthly', ${kind}, 'EUR', '3', 49, 'paid', ${new Date(T0 + DAY).toISOString()}::timestamptz,
              ${new Date(T0 - H).toISOString()}::timestamptz, ${new Date(T0 - 2 * H).toISOString()}::timestamptz,
              ${products === null ? null : JSON.stringify(products)}::jsonb)`);
  }
  const user = async (n: number) => {
    const [r] = (await db.execute(
      sql`SELECT subscription_status, trial_ends_at, trial_warning_sent_at FROM users WHERE id = ${idOf(n)}`,
    )) as unknown as Array<{ subscription_status: string; trial_ends_at: string | Date | null; trial_warning_sent_at: string | Date | null }>;
    const d = (v: string | Date | null) => (v === null ? null : new Date(v));
    return { subscription_status: r.subscription_status, trial_ends_at: d(r.trial_ends_at), trial_warning_sent_at: d(r.trial_warning_sent_at) };
  };
  const events = async () =>
    (await db.execute(
      sql`SELECT user_id, level, source, event, message, metadata FROM events ORDER BY user_id, event, message`,
    )) as unknown as Array<{ user_id: string; level: string; event: string; message: string; metadata: Record<string, unknown> }>;
  /** Every row the cron can touch, in a stable order, timestamps included. */
  async function snapshot() {
    const rows = async (q: ReturnType<typeof sql>) => JSON.stringify(await db.execute(q));
    return {
      users: await rows(sql`SELECT * FROM users WHERE email LIKE 'trial-%@example.com' ORDER BY id`),
      phones: await rows(sql`SELECT user_id, phone_number, label, twilio_sid, country_code FROM phone_numbers ORDER BY phone_number`),
      calls: await rows(sql`SELECT user_id, duration_seconds FROM calls ORDER BY user_id, duration_seconds`),
      orders: await rows(sql`SELECT user_id, kind, status, products FROM payment_orders ORDER BY user_id, kind`),
      events: JSON.stringify(await events()),
    };
  }
  async function run(sw: string | undefined) {
    if (sw === undefined) delete process.env.TRIAL_END_EMAIL;
    else process.env.TRIAL_END_EMAIL = sw;
    const res = await GET(
      new NextRequest("http://localhost/api/cron/trial-cleanup", { headers: { "x-internal-secret": "mock-internal-secret" } }),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    delete body.elapsedMs;
    return body;
  }
  const sorted = (a: string[]) => [...a].sort();

  // ─── 1. Switch off ─────────────────────────────────────────────────────
  // 1 expired (warned) · 2 expired (not warned) · 3 minutes used up before the
  // end date · 4 within limits · 5 admin with minutes used up · 6 active ·
  // 7 already paused · 8 expired, minutes used up too.
  async function offFixtures() {
    await reset();
    await mkUser(1, { endsInMs: -H, warned: true, phone: true });
    await mkUser(2, { endsInMs: -2 * H });
    await mkUser(3, { endsInMs: 5 * DAY, seconds: 6000, phone: true });
    await mkUser(4, { endsInMs: 5 * DAY, seconds: 120 });
    await mkUser(5, { endsInMs: 5 * DAY, seconds: 9000, role: "admin" });
    await mkUser(6, { status: "active", endsInMs: null, seconds: 9000 });
    await mkUser(7, { status: "trial_paused", endsInMs: -3 * DAY });
    await mkUser(8, { endsInMs: -H, seconds: 7000, warned: true });
  }
  const offResults: Array<{ body: Record<string, unknown>; snap: Awaited<ReturnType<typeof snapshot>> }> = [];
  for (const sw of [undefined, "off", "", "ON", "true", " on"]) {
    await offFixtures();
    const before = await snapshot();
    const body = await run(sw);
    const snap = await snapshot();
    assert.equal(pausedMails.length, 0, `switch ${JSON.stringify(sw)}: no paused e-mail`);
    assert.equal(warnings.length, 0, `switch ${JSON.stringify(sw)}: nobody is in the warning window`);
    // The previous response shape, key for key.
    assert.deepEqual(Object.keys(body), ["ok", "warnedCount", "pausedCount", "numbersReleasedCount", "warned", "paused", "released"]);
    assert.deepEqual(sorted(body.paused as string[]), [emailOf(1), emailOf(2), emailOf(8)], "off: only the expired trials are paused");
    assert.equal((await user(1)).subscription_status, "trial_paused");
    assert.equal((await user(2)).subscription_status, "trial_paused");
    assert.equal((await user(8)).subscription_status, "trial_paused");
    // Minutes used up: nothing changes; trial_ends_at never moves.
    for (const n of [3, 4, 5, 6, 7]) {
      const was = (JSON.parse(before.users) as Array<{ id: string }>).find((r) => r.id === idOf(n));
      const is = (JSON.parse(snap.users) as Array<{ id: string }>).find((r) => r.id === idOf(n));
      assert.deepEqual(is, was, `off: account ${n} untouched`);
    }
    for (const n of [1, 2, 8]) {
      const was = (JSON.parse(before.users) as Array<Record<string, unknown>>).find((r) => r.id === idOf(n))!;
      const is = (JSON.parse(snap.users) as Array<Record<string, unknown>>).find((r) => r.id === idOf(n))!;
      assert.deepEqual({ ...is, subscription_status: was.subscription_status }, was, `off: account ${n} only changes its status`);
    }
    const ev = await events();
    assert.deepEqual(ev.map((e) => e.event), ["trial_paused", "trial_paused", "trial_paused"]);
    for (const e of ev) assert.deepEqual(Object.keys(e.metadata), ["trialEndsAt"], "off: the previous event metadata");
    offResults.push({ body, snap });
  }
  // The selection has no ORDER BY (as before), so the list order is the
  // heap's: compared as sets.
  const normal = (b: Record<string, unknown>) => ({ ...b, paused: sorted(b.paused as string[]) });
  for (const r of offResults.slice(1)) {
    assert.deepEqual(normal(r.body), normal(offResults[0].body), "every off value: the same response");
    assert.deepEqual(r.snap, offResults[0].snap, "every off value: the same rows");
  }
  console.log("ok 1 switch off: same response and rows for unset/off/garbage; no minutes pause, no e-mail");

  // ─── 2. Switch on: expired / minutes used up, once ─────────────────────
  await offFixtures();
  await mkUser(9, { endsInMs: 5 * DAY, seconds: 5999 }); // one second short
  await mkUser(10, { endsInMs: null, seconds: 6000 }); // no end date yet, minutes used up
  const runStart = Date.now();
  const on1 = await run("on");
  const runEnd = Date.now();
  assert.deepEqual(sorted(on1.paused as string[]), sorted([emailOf(1), emailOf(2), emailOf(8), emailOf(3), emailOf(10)]));
  assert.equal(on1.pausedForMinutesCount, 2);
  assert.equal(on1.pausedEmailedCount, 5);
  assert.deepEqual(sorted(pausedMails.map((m) => m.to)), sorted([emailOf(1), emailOf(2), emailOf(3), emailOf(8), emailOf(10)]), "exactly one paused e-mail per paused account");
  assert.equal(pausedMails.find((m) => m.to === emailOf(1))!.opts.phoneNumber, "+15550000001", "the paused e-mail names the kept number");
  assert.equal(pausedMails.find((m) => m.to === emailOf(2))!.opts.phoneNumber, null);
  for (const n of [3, 10]) {
    const u = await user(n);
    assert.equal(u.subscription_status, "trial_paused", `minutes used up: account ${n} paused`);
    const t = u.trial_ends_at!.getTime();
    assert.ok(t >= runStart - 1000 && t <= runEnd + 1000, `minutes pause: trial_ends_at moved to the pause (${n})`);
  }
  assert.equal((await user(1)).trial_ends_at!.getTime(), T0 - H, "an expired trial keeps its end date");
  for (const n of [4, 5, 6, 7, 9]) {
    const u = await user(n);
    assert.equal(u.subscription_status, n === 6 ? "active" : n === 7 ? "trial_paused" : "trialing", `account ${n} unchanged`);
  }
  let ev = await events();
  assert.equal(ev.filter((e) => e.event === "trial_paused_email_sent").length, 5);
  assert.equal(ev.filter((e) => e.event === "trial_paused" && e.metadata.cause === "minutes").length, 2);
  for (const e of ev) {
    assert.doesNotMatch(e.message + JSON.stringify(e.metadata), /@|\+1555/, `no address or number in ${e.event}`);
  }
  // A re-run: nothing more.
  const on2 = await run("on");
  assert.deepEqual(on2.paused, []);
  assert.equal(on2.pausedEmailedCount, 0);
  assert.equal(pausedMails.length, 5, "a re-run sends no second e-mail");
  console.log("ok 2 switch on: expired + minutes used up paused, one e-mail each, none on a re-run");

  // ─── 3. Concurrent runs ────────────────────────────────────────────────
  await reset();
  for (let n = 20; n < 26; n++) await mkUser(n, { endsInMs: -H * (n - 19), warned: true });
  for (let n = 26; n < 32; n++) await mkUser(n, { endsInMs: 4 * DAY, seconds: 6000 + n });
  const runs = await Promise.all([run("on"), run("on"), run("on"), run("on")]);
  const allPaused = runs.flatMap((r) => r.paused as string[]);
  assert.equal(allPaused.length, 12, "each account paused by exactly one run");
  assert.equal(new Set(allPaused).size, 12);
  assert.equal(pausedMails.length, 12, "exactly one e-mail per account across concurrent runs");
  assert.equal(new Set(pausedMails.map((m) => m.to)).size, 12);
  console.log("ok 3 four concurrent runs: exactly one e-mail per account");

  // ─── 4. A send failure ─────────────────────────────────────────────────
  await reset();
  await mkUser(40, { endsInMs: -H, warned: true });
  await mkUser(41, { endsInMs: 3 * DAY, seconds: 6500 });
  onPaused = async (to) => (to === emailOf(40) ? { ok: false, error: `validation_error: Invalid \`to\`: ${to}` } : "throw");
  const f1 = await run("on");
  assert.equal(f1.pausedEmailedCount, 0);
  assert.equal((await user(40)).subscription_status, "trial_paused", "a failed send never reverts the pause");
  assert.equal((await user(41)).subscription_status, "trial_paused", "a thrown send never reverts the pause");
  ev = await events();
  const failed = ev.filter((e) => e.event === "trial_paused_email_failed");
  assert.equal(failed.length, 2);
  assert.deepEqual(failed.map((e) => e.metadata).sort((a, b) => String(a.errorClass).localeCompare(String(b.errorClass))), [
    { errorClass: "TypeError" },
    { errorClass: "validation_error" },
  ]);
  for (const e of failed) {
    assert.equal(e.level, "error");
    assert.doesNotMatch(e.message + JSON.stringify(e.metadata), /@|example\.com|Invalid/, "the error class only");
  }
  onPaused = null;
  await run("on");
  await run("on");
  assert.equal(pausedMails.length, 2, "never resent");
  console.log("ok 4 send failure: still paused, error class logged, never resent");

  // ─── 5. Paid accounts are never e-mailed ───────────────────────────────
  await reset();
  await mkUser(50, { endsInMs: -H, warned: true, paid: true }); // expired, paid (an edge race)
  await mkUser(51, { endsInMs: 3 * DAY, seconds: 6000 }); // minutes used up, paid multi-line
  await addPaidOrder(51, "plan_change", [{ kind: "base", key: "basic", amount: 49 }]);
  await mkUser(52, { endsInMs: 30 * H, paid: true }); // in the warning window, paid
  await mkUser(53, { endsInMs: 20 * H }); // in the warning window
  await mkUser(54, { endsInMs: 22 * H }); // in the warning window
  await mkUser(55, { endsInMs: -H, warned: true }); // expired
  await mkUser(56, { endsInMs: -2 * H, warned: true }); // expired
  // An order paid DURING the run: the first e-mail of each kind pays the
  // other account of that kind, which the fresh read before its send catches.
  const pairs: Record<string, string> = { [emailOf(53)]: idOf(54), [emailOf(54)]: idOf(53), [emailOf(55)]: idOf(56), [emailOf(56)]: idOf(55) };
  const payOther = async (to: string) => {
    const other = pairs[to];
    if (other) await addPaidOrder(Number(other.slice(-12)), "renewal");
  };
  onWarning = payOther;
  onPaused = async (to) => {
    await payOther(to);
    return { ok: true };
  };
  const p1 = await run("on");
  assert.equal((await user(51)).subscription_status, "trialing", "minutes used up but paid: not paused");
  assert.equal(warnings.length, 1, "warning: one of 53/54, never 52 (paid) nor the one paid during the run");
  assert.ok([emailOf(53), emailOf(54)].includes(warnings[0].to));
  assert.equal(pausedMails.length, 1, "paused: one of 55/56, never 50/51 (paid) nor the one paid during the run");
  assert.ok([emailOf(55), emailOf(56)].includes(pausedMails[0].to));
  // The pause itself is as before (expired), the e-mail is what is withheld.
  assert.equal((await user(50)).subscription_status, "trial_paused");
  assert.equal(p1.pausedEmailedCount, 1);
  // The paid ones in the warning window keep no stamp and still get nothing next run.
  await run("on");
  await run(undefined);
  assert.equal(warnings.length, 1);
  assert.equal(pausedMails.length, 1);
  // The selection on its own: with the guard switched off (always "may"),
  // the paid accounts are still never e-mailed, because the queries (the
  // warning query, the minutes query, the claim's RETURNING) exclude them.
  await reset();
  const realGuard = trialCleanupDeps.mayEmail;
  trialCleanupDeps.mayEmail = () => true;
  await mkUser(57, { endsInMs: 30 * H, paid: true }); // warning window, paid
  await mkUser(58, { endsInMs: 20 * H }); // warning window
  await mkUser(59, { endsInMs: -H, warned: true, paid: true }); // expired, paid
  await mkUser(68, { endsInMs: 3 * DAY, seconds: 6000, paid: true }); // minutes used up, paid
  await run("on");
  assert.deepEqual(warnings.map((w) => w.to), [emailOf(58)], "the warning query excludes a paid account");
  assert.equal(pausedMails.length, 0, "the claim's RETURNING and the minutes query exclude paid accounts");
  assert.equal((await user(59)).subscription_status, "trial_paused", "an expired paid trial is paused as before");
  assert.equal((await user(68)).subscription_status, "trialing", "a paid account is never newly paused for minutes");
  trialCleanupDeps.mayEmail = realGuard;
  console.log("ok 5 paid accounts: excluded by the selection and by the guard before the send");

  // ─── 6. The warning: real days, skipped once ended, deduped ────────────
  await reset();
  await mkUser(60, { endsInMs: 47 * H, locale: "he", phone: true });
  await mkUser(61, { endsInMs: 25 * H });
  await mkUser(62, { endsInMs: 10 * 60_000, locale: "en" }); // ends in 10 minutes
  await mkUser(63, { endsInMs: -10 * 60_000 }); // ended 10 minutes ago, never warned
  await mkUser(64, { endsInMs: 49 * H }); // not yet in the window
  await mkUser(65, { endsInMs: 30 * H, seconds: 6000 }); // minutes used up
  const now = new Date();
  const w1 = await run(undefined);
  const got = Object.fromEntries(warnings.map((w) => [w.to, w.opts]));
  assert.deepEqual(sorted(Object.keys(got)), sorted([emailOf(60), emailOf(61), emailOf(62), emailOf(65)]), "switch off: minutes used up still warned as before; ended and too-early skipped");
  for (const n of [60, 61, 62]) {
    const expected = trialWarningDays(new Date(T0 + (n === 60 ? 47 * H : n === 61 ? 25 * H : 10 * 60_000)), now);
    assert.equal(got[emailOf(n)].warningDays, expected, `account ${n}: the real days left`);
    assert.ok([0, 1, 2].includes(got[emailOf(n)].warningDays!), `account ${n}: 0, 1 or 2`);
  }
  assert.equal(got[emailOf(62)].warningDays, 0, "ends in 10 minutes -> 0");
  assert.equal(got[emailOf(60)].locale, "he");
  assert.equal(got[emailOf(60)].phoneNumber, "+15550000060");
  assert.ok((await user(60)).trial_warning_sent_at, "stamped");
  assert.equal((await user(63)).trial_warning_sent_at, null, "an ended trial is not warned");
  assert.equal((await user(63)).subscription_status, "trial_paused");
  assert.equal(w1.warnedCount, 4);
  const w2 = await run(undefined);
  assert.equal(w2.warnedCount, 0, "deduped by trial_warning_sent_at");
  assert.equal(warnings.length, 4);
  // Switch on: an account in the window whose minutes are used up gets the
  // paused e-mail, not a warning.
  await reset();
  await mkUser(66, { endsInMs: 30 * H, seconds: 6000 });
  await mkUser(67, { endsInMs: 30 * H, seconds: 60 });
  await run("on");
  assert.deepEqual(warnings.map((w) => w.to), [emailOf(67)]);
  assert.deepEqual(pausedMails.map((m) => m.to), [emailOf(66)]);
  console.log("ok 6 warning: real days 0/1/2, skipped once ended, deduped");

  // ─── 7. Phase 3 unchanged; 30 days from the minutes pause ──────────────
  await reset();
  await mkUser(70, { status: "trial_paused", endsInMs: -31 * DAY, phone: true });
  await mkUser(71, { status: "trial_paused", endsInMs: -29 * DAY, phone: true });
  await mkUser(72, { endsInMs: 6 * DAY, seconds: 6000, phone: true });
  for (const sw of [undefined, "on"]) {
    releases = [];
    await db.execute(sql`INSERT INTO phone_numbers (user_id, phone_number) VALUES (${idOf(70)}, '+15550000070') ON CONFLICT DO NOTHING`);
    const r = await run(sw);
    assert.deepEqual(releases, [idOf(70)], `switch ${sw ?? "unset"}: released 30 days after the end only`);
    assert.equal(r.numbersReleasedCount, 1);
  }
  // 72 was paused for minutes by the "on" run, its end date moved to the
  // pause: not released now, released once 30 days have passed since.
  assert.equal((await user(72)).subscription_status, "trial_paused");
  releases = [];
  await run("on");
  assert.deepEqual(releases, [], "a minutes pause is not released right away");
  const pausedAt = (await user(72)).trial_ends_at!.getTime();
  await db.execute(sql`UPDATE users SET trial_ends_at = ${new Date(pausedAt - 30 * DAY - 60_000).toISOString()}::timestamptz WHERE id = ${idOf(72)}`);
  await run("on");
  assert.deepEqual(releases, [idOf(72)], "released 30 days after the minutes pause");
  console.log("ok 7 phase 3 unchanged; the 30 days count from the minutes pause");

  await reset();
  console.log("trial-cleanup-db: ok");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
