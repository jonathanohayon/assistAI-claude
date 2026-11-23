// The renewal reminder (cron/billing Phase 4, lib/renewal-reminder.ts)
// against a THROWAWAY Postgres, through the REAL cron route, with only the
// sender injected (lib/renewal-reminder-deps.ts): nothing is ever sent.
//   1. RENEWAL_REMINDER_EMAIL off (unset, "off", "", "ON", "true", "1"): the
//      cron response and every table are byte-identical whatever the off
//      value, the response has exactly the pre-existing keys, the candidate
//      query never runs, renewal_reminders stays empty;
//   2. on: the account 2 days before paid_until gets ONE email (its locale,
//      its billing link); a re-run sends none; two concurrent runs send one;
//      Phases 1-3 do exactly what they do with the switch off;
//   3. never: 10 days before, already paid the next period (paid_until moved,
//      or a paid base line starting at paid_until), expired, trialing,
//      admin, no email;
//   4. no address in any event;
//   5. fail-open: the candidate query throwing, and a REAL database error
//      (the claim table missing): the cron still answers 200 ok, Phases 1-3
//      unaffected, the error class only;
//   6. the real sender, without any email key: the console fallback, ok.
// Mock data only (example.com). Run with:  bash scripts/renewal-reminder-db.sh
// Only a 127.0.0.1/localhost URL is accepted; DATABASE_URL is never read from
// the shell.

import assert from "node:assert/strict";

const url = process.env.RENEWAL_REMINDER_DB_TEST_URL;
if (!url) {
  console.log("skip: renewal-reminder-db (no RENEWAL_REMINDER_DB_TEST_URL — see scripts/renewal-reminder-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /RESEND|TWILIO|WHATSAPP|EMAIL_FROM|OPENAI|REALTIME_API_KEY|RENEWAL_REMINDER_EMAIL|USAGE_WARNINGS/i.test(k))) {
  throw new Error("refusing to run with a provider env or the switch set");
}
process.env.DATABASE_URL = url;
process.env.INTERNAL_SECRET = "mock-internal-secret";

const H = 3_600_000;
const DAY = 24 * H;

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { renewalReminderDeps } = await import("../../lib/renewal-reminder-deps");
  const { sendRenewalReminderEmail } = await import("../../lib/email");
  const { GET } = await import("../../app/api/cron/billing/route");
  type Deps = typeof renewalReminderDeps;

  const rows = async <T>(q: ReturnType<typeof sql>) => {
    const r = (await db.execute(q)) as unknown;
    return (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as T[];
  };
  const count = async (q: ReturnType<typeof sql>) => Number((await rows<{ n: number }>(q))[0].n);

  // ─── Injected sender: record, never send ──────────────────────────────
  type Sent = { to: string; input: Parameters<Deps["send"]>[1] };
  let sent: Sent[] = [];
  renewalReminderDeps.send = async (to, input) => {
    sent.push({ to, input });
    await new Promise((r) => setTimeout(r, 5)); // widen the race window
    return { ok: true };
  };
  let listCalls = 0;
  const realList = renewalReminderDeps.listCandidates;
  renewalReminderDeps.listCandidates = async (now) => {
    listCalls++;
    return realList(now);
  };

  // ─── Fixtures (fixed instants, so every reseed is the same bytes) ──────
  const T0 = Date.now();
  const iso = (ms: number) => new Date(T0 + ms).toISOString();
  const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const emailOf = (n: number) => `renew-${n}@example.com`;
  const A = {
    DUE: 1, // active, 2 days before paid_until -> the ONE reminder
    FAR: 2, // active, 10 days before
    PAID_MOVED: 3, // paid the next period early: paid_until a month away
    PAID_LINE: 4, // paid base line starting at paid_until (paid_until not moved)
    EXPIRED: 5,
    TRIAL: 6,
    ADMIN: 7, // admin, 2 days before
    NO_EMAIL: 8, // email '' , 2 days before
    PAST: 9, // active, paid_until 1 h ago -> Phase 2 expires it
    DOWN: 10, // scheduled downgrade due -> Phase 1 applies it
  } as const;
  type U = { n: number; email?: string; role?: string; status: string; plan?: string; paidUntil: string | null; locale?: string; scheduled?: boolean };
  const users: U[] = [
    { n: A.DUE, status: "active", paidUntil: iso(2 * DAY), locale: "he" },
    { n: A.FAR, status: "active", paidUntil: iso(10 * DAY) },
    { n: A.PAID_MOVED, status: "active", paidUntil: iso(32 * DAY) },
    { n: A.PAID_LINE, status: "active", paidUntil: iso(2 * DAY) },
    { n: A.EXPIRED, status: "expired", paidUntil: iso(-1 * DAY) },
    { n: A.TRIAL, status: "trialing", paidUntil: null },
    { n: A.ADMIN, status: "active", paidUntil: iso(2 * DAY), role: "admin" },
    { n: A.NO_EMAIL, status: "active", paidUntil: iso(2 * DAY), email: "" },
    { n: A.PAST, status: "active", paidUntil: iso(-H) },
    { n: A.DOWN, status: "active", paidUntil: iso(20 * DAY), plan: "premium", scheduled: true },
  ];
  async function seed() {
    await db.execute(sql`DELETE FROM events`);
    await db.execute(sql`DELETE FROM users WHERE id::text LIKE '00000000-0000-4000-8000-%'`);
    for (const u of users) {
      await db.execute(sql`INSERT INTO users (id, email, password_hash, role, subscription_plan, subscription_status, subscription_period, paid_until, locale,
                                               scheduled_plan, scheduled_plan_period, scheduled_plan_at, created_at)
        VALUES (${idOf(u.n)}, ${u.email ?? emailOf(u.n)}, 'x', ${u.role ?? "user"}, ${u.plan ?? "global"}, ${u.status}, 'monthly', ${u.paidUntil}, ${u.locale ?? "fr"},
                ${u.scheduled ? "global" : null}, ${u.scheduled ? "monthly" : null}, ${u.scheduled ? iso(-H) : null}, ${iso(-60 * DAY)})`);
    }
    const order = async (n: number, paidAt: string, products: unknown) =>
      db.execute(sql`INSERT INTO payment_orders (id, user_id, plan_key, period, currency, coin, expected_amount, status, expires_at, paid_at, created_at, products)
        VALUES (${idOf(1000 + n)}, ${idOf(n)}, 'global', 'monthly', 'EUR', '3', 10, 'paid', ${paidAt}, ${paidAt}, ${paidAt}, ${JSON.stringify(products)}::jsonb)`);
    // Paid early for the next period: paid_until moved a month (legacy-shaped and multi-line alike).
    await order(A.PAID_MOVED, iso(-1 * DAY), [{ kind: "base", product: "reception", period: "monthly", amount: 10, periodStart: iso(2 * DAY), periodEnd: iso(32 * DAY) }]);
    // A paid base line starting AT the current paid_until.
    await order(A.PAID_LINE, iso(-1 * DAY), [{ kind: "base", product: "reception", period: "monthly", amount: 10, periodStart: iso(2 * DAY), periodEnd: iso(32 * DAY) }]);
  }

  // Every public table, as JSON rows minus the columns stamped by now() /
  // random ids on insert (events.id, *_at defaults the fixtures do not set).
  async function snapshot(opts: { dropRenewalEvents?: boolean } = {}): Promise<string> {
    const tables = await rows<{ t: string }>(sql`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`);
    const out: string[] = [];
    for (const { t } of tables) {
      const ident = sql.identifier(t);
      const filter = t === "events" && opts.dropRenewalEvents ? sql`WHERE event NOT LIKE 'renewal_reminder%'` : sql``;
      const r = await rows<{ n: number; h: string }>(sql`
        SELECT count(*)::int AS n, md5(coalesce(string_agg(j::text, E'\n' ORDER BY j::text), '')) AS h
        FROM (SELECT (to_jsonb(x) - 'id' - 'created_at' - 'updated_at' - 'sent_at' - 'last_sent_at') AS j FROM ${ident} x ${filter}) s`);
      // app_settings holds the health check's alert ledger (dedup timestamps, not this phase's).
      if (t === "app_settings") continue;
      out.push(`${t}|${r[0].n}|${r[0].h}`);
    }
    return out.join("\n");
  }

  const call = async () => {
    const res = await GET(new NextRequest("http://localhost/api/cron/billing", { headers: { "x-internal-secret": "mock-internal-secret" } }));
    const body = (await res.json()) as Record<string, unknown>;
    delete body.tookMs;
    return { status: res.status, body };
  };
  const setSwitch = (v: string | undefined) => {
    if (v === undefined) delete process.env.RENEWAL_REMINDER_EMAIL;
    else process.env.RENEWAL_REMINDER_EMAIL = v;
  };
  const noAddressInEvents = async () => {
    const leaked = await count(sql`SELECT count(*)::int AS n FROM events WHERE (message || coalesce(metadata::text, '')) LIKE '%@example.com%'`);
    assert.equal(leaked, 0, "no address in any event");
  };

  // Warm-up: the health check claims its alert slot once (deduped after).
  await seed();
  await call();

  // ─── 1. Off: byte-identical whatever the off value ────────────────────
  const offValues = [undefined, "off", "", "ON", "true", "1", " on"];
  let offBody: string | null = null;
  let offSnap: string | null = null;
  for (const v of offValues) {
    await seed();
    setSwitch(v);
    sent = [];
    listCalls = 0;
    const r = await call();
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body), ["ok", "downgraded", "expired", "health"], `off (${JSON.stringify(v)}): exactly the pre-existing keys`);
    const s = await snapshot();
    const b = JSON.stringify(r.body);
    if (offBody === null) {
      offBody = b;
      offSnap = s;
    }
    assert.equal(b, offBody, `off (${JSON.stringify(v)}): the same response bytes`);
    assert.equal(s, offSnap, `off (${JSON.stringify(v)}): the same table bytes`);
    assert.equal(listCalls, 0, "off: the candidate query never runs");
    assert.equal(sent.length, 0);
    assert.equal(await count(sql`SELECT count(*)::int AS n FROM renewal_reminders`), 0);
  }
  const off = JSON.parse(offBody!) as { downgraded: number; expired: number };
  assert.equal(off.downgraded, 1, "Phase 1 ran (fixture sanity)");
  assert.equal(off.expired, 1, "Phase 2 ran (fixture sanity)");
  console.log(`ok: off (${offValues.length} values): response + every table byte-identical, query never run, no claim`);

  // ─── 2. On: one email, re-run none, Phases 1-3 unchanged ──────────────
  await seed();
  setSwitch("on");
  sent = [];
  let r = await call();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.renewalReminders, { enabled: true, candidates: 1, claimed: 1, sent: 1, failed: 0 });
  const { renewalReminders: _rr, ...rest } = r.body;
  assert.equal(JSON.stringify(rest), offBody, "on: Phases 1-3 answer exactly as with the switch off");
  assert.equal(await snapshot({ dropRenewalEvents: true }).then((s) => s.replace(/^renewal_reminders\|.*$/m, "")), offSnap!.replace(/^renewal_reminders\|.*$/m, ""), "on: Phases 1-3 wrote exactly the same rows");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, emailOf(A.DUE));
  assert.equal(sent[0].input.locale, "he");
  assert.equal(sent[0].input.paidUntil.toISOString(), iso(2 * DAY));
  assert.equal(sent[0].input.link, "https://aitamara.com/he/dashboard/billing");
  const claims = await rows<{ user_id: string; period_end: Date | string }>(sql`SELECT user_id, period_end FROM renewal_reminders`);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].user_id, idOf(A.DUE));
  assert.equal(new Date(claims[0].period_end).toISOString(), iso(2 * DAY));
  const ev = await rows<{ event: string; user_id: string; metadata: Record<string, unknown> }>(sql`SELECT event, user_id, metadata FROM events WHERE event LIKE 'renewal_reminder%'`);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].event, "renewal_reminder_sent");
  assert.equal(ev[0].user_id, idOf(A.DUE));
  assert.deepEqual(Object.keys(ev[0].metadata).sort(), ["locale", "periodEnd"]);
  await noAddressInEvents();
  // A re-run: none.
  r = await call();
  assert.deepEqual(r.body.renewalReminders, { enabled: true, candidates: 1, claimed: 0, sent: 0, failed: 0 });
  assert.equal(sent.length, 1, "a re-run sends nothing");
  console.log("ok: on: 2 days before -> one email (he, billing link), Phases 1-3 identical; re-run -> none");

  // ─── 3. Two concurrent runs -> one ────────────────────────────────────
  await seed();
  await db.execute(sql`DELETE FROM renewal_reminders`);
  sent = [];
  const [c1, c2] = await Promise.all([call(), call()]);
  assert.equal(c1.status, 200);
  assert.equal(c2.status, 200);
  const total = (c1.body.renewalReminders as { sent: number }).sent + (c2.body.renewalReminders as { sent: number }).sent;
  assert.equal(total, 1, "two concurrent runs: one email");
  assert.equal(sent.length, 1);
  assert.equal(await count(sql`SELECT count(*)::int AS n FROM renewal_reminders`), 1);
  await noAddressInEvents();
  console.log("ok: two concurrent runs -> one email, one claim");

  // ─── 4. Who never gets it (explicit) ──────────────────────────────────
  const never = [A.FAR, A.PAID_MOVED, A.PAID_LINE, A.EXPIRED, A.TRIAL, A.ADMIN, A.NO_EMAIL, A.PAST, A.DOWN];
  assert.equal(await count(sql`SELECT count(*)::int AS n FROM renewal_reminders WHERE user_id::text IN (${sql.join(never.map((n) => sql`${idOf(n)}`), sql`, `)})`), 0);
  assert.ok(sent.every((s) => s.to === emailOf(A.DUE)));
  console.log("ok: none for 10 days before / paid next period (moved + base line) / expired / trialing / admin / no email / past");

  // ─── 5. Fail-open ─────────────────────────────────────────────────────
  // a) the candidate query throws.
  await seed();
  await db.execute(sql`DELETE FROM renewal_reminders`);
  sent = [];
  renewalReminderDeps.listCandidates = async () => {
    throw new TypeError(`mock failure for ${emailOf(A.DUE)}`);
  };
  r = await call();
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.renewalReminders, { enabled: true, candidates: 0, claimed: 0, sent: 0, failed: 0, error: "TypeError" });
  {
    const { renewalReminders: _x, ...p13 } = r.body;
    assert.equal(JSON.stringify(p13), offBody, "a failing phase: Phases 1-3 answer as with the switch off");
  }
  assert.equal(await snapshot({ dropRenewalEvents: true }), offSnap, "a failing phase: Phases 1-3 wrote exactly the same rows, nothing else");
  const failEv = await rows<{ event: string; metadata: Record<string, unknown> }>(sql`SELECT event, metadata FROM events WHERE event LIKE 'renewal_reminder%'`);
  assert.deepEqual(failEv.map((e) => [e.event, e.metadata.errorClass]), [["renewal_reminder_phase_failed", "TypeError"]]);
  await noAddressInEvents();
  renewalReminderDeps.listCandidates = realList;
  // b) a REAL database error: the claim table is missing.
  await seed();
  sent = [];
  await db.execute(sql`ALTER TABLE renewal_reminders RENAME TO renewal_reminders_hidden`);
  try {
    r = await call();
  } finally {
    await db.execute(sql`ALTER TABLE renewal_reminders_hidden RENAME TO renewal_reminders`);
  }
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.renewalReminders, { enabled: true, candidates: 1, claimed: 0, sent: 0, failed: 1 });
  {
    const { renewalReminders: _x, ...p13 } = r.body;
    assert.equal(JSON.stringify(p13), offBody, "a DB error in the phase: Phases 1-3 unchanged");
  }
  assert.equal(sent.length, 0);
  const dbEv = await rows<{ event: string; metadata: Record<string, unknown> }>(sql`SELECT event, metadata FROM events WHERE event LIKE 'renewal_reminder%'`);
  assert.equal(dbEv.length, 1);
  assert.equal(dbEv[0].event, "renewal_reminder_failed");
  assert.deepEqual(Object.keys(dbEv[0].metadata), ["errorClass"]);
  await noAddressInEvents();
  console.log(`ok: fail-open: a thrown error and a real DB error (${String(dbEv[0].metadata.errorClass)}) -> 200 ok, Phases 1-3 unchanged, error class only`);

  // ─── 6. The real sender, no email key: console fallback, never sent ───
  const origWarn = console.warn;
  const warned: string[] = [];
  console.warn = (...a: unknown[]) => void warned.push(a.join(" "));
  try {
    const res = await sendRenewalReminderEmail(emailOf(A.DUE), { locale: "fr", paidUntil: new Date("2026-11-26T08:00:00Z"), link: "https://aitamara.com/fr/dashboard/billing" });
    assert.deepEqual(res, { ok: true, fallback: "console_log" });
  } finally {
    console.warn = origWarn;
  }
  assert.equal(warned.length, 1);
  assert.ok(warned[0].includes("Votre service s'arrête le 26 novembre 2026"), "the fallback prints the FR subject");
  assert.ok(!warned[0].includes("@"), "the fallback never prints the address");
  console.log("ok: real sender without a key: console fallback (subject only), nothing sent");

  setSwitch(undefined);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
