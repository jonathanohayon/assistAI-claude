// The renewal reminder (lib/renewal-reminder.ts) with every effect INJECTED
// (an in-memory claim table, a recording sender): the switch parser, the
// window, the "already paid the next period" rule, once per account per
// period (re-run, concurrent runs), who never gets it (expired, trialing,
// admin, no email, deleted, 10 days before), fail-open, the FR/HE/EN copy from
// messages/*.json, and no address in any event. No email provider is reached.
// Mock data only (example.com).
// Run with:  npx tsx scripts/tests/renewal-reminder.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createTranslator } from "use-intl/core";

import type { LogEvent } from "../../lib/logger";
import type { OrderLine } from "../../lib/order-lines";
import {
  REMINDER_DAYS_BEFORE,
  formatStopDate,
  hasPaidNextPeriod,
  inReminderWindow,
  parseRenewalReminderSwitch,
  publicAppOrigin,
  reminderBillingUrl,
  reminderLocale,
  renderRenewalReminderEmail,
  runRenewalReminders,
  type ReminderAccount,
  type ReminderInput,
  type ReminderLocale,
  type RenewalReminderDeps,
} from "../../lib/renewal-reminder";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const DAY = 24 * 60 * 60 * 1000;

// ── Switch ────────────────────────────────────────────────────────────────
assert.equal(REMINDER_DAYS_BEFORE, 3);
for (const v of [undefined, null, "", "off", "ON", " on", "on ", "true", "1", "yes"]) {
  assert.equal(parseRenewalReminderSwitch(v), "off", `switch ${JSON.stringify(v)}`);
}
assert.equal(parseRenewalReminderSwitch("on"), "on");
console.log("ok: switch parser (exactly \"on\" is on)");

// ── Window ────────────────────────────────────────────────────────────────
const NOW = new Date("2026-11-23T10:00:00Z");
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
assert.equal(inReminderWindow(at(2), NOW), true, "2 days before");
assert.equal(inReminderWindow(at(3), NOW), true, "exactly 3 days before");
assert.equal(inReminderWindow(new Date(at(3).getTime() + 1), NOW), false, "just over 3 days");
assert.equal(inReminderWindow(at(10), NOW), false, "10 days before");
assert.equal(inReminderWindow(NOW, NOW), false, "ends now");
assert.equal(inReminderWindow(at(-1), NOW), false, "already passed");
assert.equal(inReminderWindow(null, NOW), false, "no paid_until");
console.log("ok: window (now, now + 3 days]");

// ── Paid the next period ──────────────────────────────────────────────────
const base = (periodStart?: string): OrderLine => ({ kind: "base", product: "reception", period: "monthly", amount: 10, ...(periodStart ? { periodStart, periodEnd: "2027-01-01T00:00:00.000Z" } : {}) }) as OrderLine;
const PU = at(2);
assert.equal(hasPaidNextPeriod(PU, []), false, "no paid order");
assert.equal(hasPaidNextPeriod(PU, [[base(at(-28).toISOString())]]), false, "the current period's order");
assert.equal(hasPaidNextPeriod(PU, [[base(PU.toISOString())]]), true, "an order starting at paid_until");
assert.equal(hasPaidNextPeriod(PU, [[base(at(5).toISOString())]]), true, "an order starting after paid_until");
assert.equal(hasPaidNextPeriod(PU, [[base()]]), false, "a base line without a period");
assert.equal(hasPaidNextPeriod(PU, [[base("not a date")]]), false, "an unreadable date never counts as paid");
console.log("ok: paid the next period = a paid base line with periodStart >= paid_until");

// ── Copy ──────────────────────────────────────────────────────────────────
const messages = {
  fr: JSON.parse(read("messages/fr.json")),
  he: JSON.parse(read("messages/he.json")),
  en: JSON.parse(read("messages/en.json")),
};
const tFor = (locale: ReminderLocale) => {
  const t = createTranslator({ locale, messages: messages[locale], namespace: "Email.renewalReminder" as never });
  return (key: "subject" | "body", vars: { date: string; link: string }) => (t as unknown as (k: string, v: unknown) => string)(key, vars);
};
assert.equal(publicAppOrigin({}), "https://aitamara.com");
assert.equal(publicAppOrigin({ APP_URL: " https://app.example.com/ " }), "https://app.example.com");
assert.equal(reminderLocale("he-IL"), "he");
assert.equal(reminderLocale("de"), "fr");
assert.equal(reminderLocale(null), "fr");
const STOP = new Date("2026-11-26T08:00:00Z");
const want = {
  fr: { date: "26 novembre 2026", subject: "Votre service s'arrête le 26 novembre 2026", body: "Votre service Tamara s'arrête le 26 novembre 2026. Renouvelez ici : https://aitamara.com/fr/dashboard/billing" },
  en: { date: "November 26, 2026", subject: "Your service stops on November 26, 2026", body: "Your Tamara service stops on November 26, 2026. Renew here: https://aitamara.com/en/dashboard/billing" },
  he: { date: formatStopDate(STOP, "he"), subject: `השירות שלכם יופסק ב-${formatStopDate(STOP, "he")}`, body: `שירות Tamara שלכם יופסק ב-${formatStopDate(STOP, "he")}. לחידוש: https://aitamara.com/he/dashboard/billing` },
};
assert.match(want.he.date, /26/);
assert.match(want.he.date, /2026/);
for (const locale of ["fr", "he", "en"] as const) {
  const link = reminderBillingUrl(locale, "https://aitamara.com");
  assert.equal(link, `https://aitamara.com/${locale}/dashboard/billing`);
  assert.equal(formatStopDate(STOP, locale), want[locale].date, `${locale} date`);
  const m = renderRenewalReminderEmail({ locale, paidUntil: STOP, link }, tFor(locale));
  assert.equal(m.subject, want[locale].subject, `${locale} subject`);
  assert.equal(m.text, want[locale].body, `${locale} body`);
  assert.ok(m.html.includes(`<a href="${link}"`), `${locale} html has the link`);
  assert.ok(m.html.includes(locale === "he" ? 'dir="rtl"' : 'dir="ltr"'), `${locale} direction`);
}
// The date is the Israel calendar day: 23:30 UTC on the 25th is already the 26th there.
assert.equal(formatStopDate(new Date("2026-11-25T23:30:00Z"), "fr"), "26 novembre 2026");
console.log("ok: FR/HE/EN subject + body from messages/*.json, link to /{locale}/dashboard/billing");

// ── Runner ────────────────────────────────────────────────────────────────
const acct = (n: number, over: Partial<ReminderAccount> = {}): ReminderAccount => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  email: `owner${n}@example.com`,
  role: "user",
  locale: "fr",
  subscriptionStatus: "active",
  paidUntil: at(2),
  ...over,
});

function world(accounts: ReminderAccount[], over: Partial<RenewalReminderDeps> = {}) {
  const claims = new Set<string>();
  const sent: Array<{ to: string; input: ReminderInput }> = [];
  const events: LogEvent[] = [];
  const orders = new Map<string, OrderLine[][]>();
  let reads = 0;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const deps: RenewalReminderDeps = {
    switchValue: () => "on",
    now: () => NOW,
    origin: () => "https://aitamara.com",
    // Like the real query: active, not admin, in the window.
    listCandidates: async (now) => {
      reads++;
      return [...byId.values()].filter((a) => a.subscriptionStatus === "active" && a.role !== "admin" && inReminderWindow(a.paidUntil, now)).map((a) => ({ ...a }));
    },
    paidOrderLines: async (id) => orders.get(id) ?? [],
    reread: async (id) => {
      const a = byId.get(id);
      return a ? { ...a } : null;
    },
    claim: async ({ userId, periodEnd }) => {
      await new Promise((r) => setTimeout(r, 1)); // widen the race window
      const k = `${userId}|${periodEnd.toISOString()}`;
      if (claims.has(k)) return false;
      claims.add(k);
      return true;
    },
    send: async (to, input) => {
      sent.push({ to, input });
      return { ok: true };
    },
    logEvent: async (e) => {
      events.push(e);
    },
    ...over,
  };
  return { deps, claims, sent, events, orders, byId, reads: () => reads };
}

const noAddress = (events: LogEvent[]) => {
  const s = JSON.stringify(events);
  assert.ok(!/@/.test(s), `no address in events: ${s}`);
};

(async () => {
  // Off: nothing read, nothing sent.
  for (const v of [undefined, "off", "ON", "true", ""]) {
    const w = world([acct(1)], { switchValue: () => v });
    const r = await runRenewalReminders(w.deps);
    assert.deepEqual(r, { enabled: false, candidates: 0, claimed: 0, sent: 0, failed: 0 });
    assert.equal(w.reads(), 0, "off: the query never runs");
    assert.equal(w.sent.length + w.events.length + w.claims.size, 0);
  }
  console.log("ok: off = nothing read, nothing claimed, nothing sent");

  // On: 2 days before -> one email; a re-run -> none.
  {
    const w = world([acct(1, { locale: "he" })]);
    const r = await runRenewalReminders(w.deps);
    assert.deepEqual(r, { enabled: true, candidates: 1, claimed: 1, sent: 1, failed: 0 });
    assert.equal(w.sent.length, 1);
    assert.equal(w.sent[0].to, "owner1@example.com");
    assert.deepEqual(w.sent[0].input, { locale: "he", paidUntil: at(2), link: "https://aitamara.com/he/dashboard/billing" });
    assert.equal(w.events.length, 1);
    assert.equal(w.events[0].event, "renewal_reminder_sent");
    noAddress(w.events);
    const r2 = await runRenewalReminders(w.deps);
    assert.equal(r2.sent, 0);
    assert.equal(w.sent.length, 1, "a re-run sends nothing");
    // A new period (paid_until moved) is a new claim.
    w.byId.get(acct(1).id)!.paidUntil = at(2.5);
    assert.equal((await runRenewalReminders(w.deps)).sent, 1, "the next period gets its own reminder");
  }
  // Two concurrent runs -> one email.
  {
    const w = world([acct(1), acct(2)]);
    const [a, b] = await Promise.all([runRenewalReminders(w.deps), runRenewalReminders(w.deps)]);
    assert.equal(a.sent + b.sent, 2);
    assert.equal(w.sent.length, 2);
    assert.deepEqual(w.sent.map((s) => s.to).sort(), ["owner1@example.com", "owner2@example.com"]);
  }
  console.log("ok: one email per account per period (re-run, new period, concurrent runs)");

  // Never: expired, trialing, admin, no email, 10 days before, paid the next period.
  {
    const w = world([
      acct(1, { subscriptionStatus: "expired" }),
      acct(2, { subscriptionStatus: "trialing" }),
      acct(3, { role: "admin" }),
      acct(4, { email: "" }),
      acct(5, { email: null }),
      acct(6, { paidUntil: at(10) }),
      acct(7),
      acct(8, { paidUntil: at(-0.1) }),
    ]);
    w.orders.set(acct(7).id, [[base(at(2).toISOString())]]);
    // Even if the query let them through, the runner drops them.
    w.deps.listCandidates = async () => [...w.byId.values()].map((a) => ({ ...a }));
    const r = await runRenewalReminders(w.deps);
    assert.deepEqual(r, { enabled: true, candidates: 0, claimed: 0, sent: 0, failed: 0 });
    assert.equal(w.sent.length + w.claims.size + w.events.length, 0);
  }
  // Deleted, paid or changed between the selection and the send: claimed, not sent.
  {
    const w = world([acct(1), acct(2), acct(3)]);
    const claim = w.deps.claim;
    w.deps.claim = async (c) => {
      const won = await claim(c);
      if (c.userId === acct(1).id) w.byId.delete(c.userId); // deleted
      if (c.userId === acct(2).id) w.byId.get(c.userId)!.paidUntil = at(32); // paid
      if (c.userId === acct(3).id) w.orders.set(c.userId, [[base(at(2).toISOString())]]); // next period paid
      return won;
    };
    const r = await runRenewalReminders(w.deps);
    assert.equal(r.claimed, 3);
    assert.equal(r.sent, 0);
    assert.equal(w.sent.length, 0);
  }
  console.log("ok: never to expired / trialing / admin / no email / 10 days / past / paid next period / deleted");

  // Fail-open: the query throws -> the error class only, never thrown.
  {
    const w = world([acct(1)], {
      listCandidates: async () => {
        throw new TypeError("mock failure for owner1@example.com");
      },
    });
    const r = await runRenewalReminders(w.deps);
    assert.deepEqual(r, { enabled: true, candidates: 0, claimed: 0, sent: 0, failed: 0, error: "TypeError" });
    assert.equal(w.events.length, 1);
    assert.equal(w.events[0].event, "renewal_reminder_phase_failed");
    noAddress(w.events);
    // Even the logger failing never throws.
    const w2 = world([acct(1)], {
      listCandidates: async () => {
        throw new RangeError("x");
      },
      logEvent: async () => {
        throw new Error("db down");
      },
    });
    const origErr = console.error;
    console.error = () => {};
    try {
      assert.equal((await runRenewalReminders(w2.deps)).error, "RangeError");
    } finally {
      console.error = origErr;
    }
  }
  // One account's send throws or fails -> the others still get theirs; class only in the event.
  {
    const w = world([acct(1), acct(2), acct(3)]);
    const send = w.deps.send;
    w.deps.send = async (to, input) => {
      if (to === "owner1@example.com") throw new TypeError(`mock network failure for ${to}`);
      if (to === "owner2@example.com") return { ok: false, error: `validation_error: bad recipient ${to}` };
      return send(to, input);
    };
    const r = await runRenewalReminders(w.deps);
    assert.deepEqual(r, { enabled: true, candidates: 3, claimed: 3, sent: 1, failed: 2 });
    const failed = w.events.filter((e) => e.event === "renewal_reminder_failed");
    assert.deepEqual(failed.map((e) => e.metadata?.errorClass).sort(), ["TypeError", "validation_error"]);
    noAddress(w.events);
    assert.equal((await runRenewalReminders(w.deps)).sent, 0, "a failed send is never resent for the period");
  }
  console.log("ok: fail-open (phase error, logger error, send error), error class only, no address");

  // ── Wiring ──────────────────────────────────────────────────────────────
  const cron = read("app/api/cron/billing/route.ts");
  assert.match(cron, /runRenewalReminders\(renewalReminderDeps\)/);
  assert.match(cron, /\.\.\.\(renewal\.enabled \? \{ renewalReminders: renewal \} : \{\}\)/, "off: the response is unchanged");
  assert.ok(cron.indexOf("runRenewalReminders(") > cron.indexOf("runUsageWarnings("), "runs after the other phases");
  const deps = read("lib/renewal-reminder-deps.ts");
  assert.match(deps, /onConflictDoNothing/);
  assert.match(deps, /process\.env\.RENEWAL_REMINDER_EMAIL/);
  const email = read("lib/email.ts");
  const fn = email.slice(email.indexOf("export async function sendRenewalReminderEmail"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.ok(!/console\.\w+\([^)]*\bto\b/.test(body), "the fallback never logs the recipient");
  console.log("ok: wiring (cron after the other phases, claim ON CONFLICT DO NOTHING)");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
