// Usage warnings (lib/usage-warnings.ts) with every effect INJECTED (an
// in-memory claim table, a recording sender): the thresholds
// (79 / 80 / 99 / 100 / 150%), once per account × entry × threshold × period,
// a new period resets, the flag off = nothing read, grandfathered and
// invalid-record accounts never warned (even at 150% with the flag on),
// trials / unpaid never, the FR/HE/EN copy from messages/*.json, and no
// address in any event. No email provider is ever reached.
// Mock data only (example.com).
// Run with:  npx tsx scripts/tests/usage-warnings.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DEFAULT_PRODUCT_CATALOGUE } from "../../lib/product-catalogue";
import { entitledProducts } from "../../lib/product-entitlement";
import { usageByProduct } from "../../lib/usage-by-product";
import {
  renderUsageWarningEmail,
  runUsageWarnings,
  thresholdsCrossed,
  usageWarningsEnabled,
  warnableAccount,
  warningLocale,
  type UsageWarningDeps,
  type WarnAccount,
  type WarningInput,
  type WarningKey,
  type WarningLocale,
  type WarningStrings,
} from "../../lib/usage-warnings";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

// ── Flag ──────────────────────────────────────────────────────────────────
for (const v of [undefined, "", "0", "false", "off", "yes"]) assert.equal(usageWarningsEnabled({ USAGE_WARNINGS_ENABLED: v }), false, `flag ${v}`);
for (const v of ["1", "true", " TRUE "]) assert.equal(usageWarningsEnabled({ USAGE_WARNINGS_ENABLED: v }), true, `flag ${v}`);
assert.equal(usageWarningsEnabled({}), false, "off by default");

// ── Thresholds on the exact seconds ───────────────────────────────────────
const pct = (p: number, included = 200) => Math.floor((included * 60 * p) / 100);
assert.deepEqual(thresholdsCrossed(pct(79), 200), []);
assert.deepEqual(thresholdsCrossed(pct(80) - 1, 200), []);
assert.deepEqual(thresholdsCrossed(pct(80), 200), [80]);
assert.deepEqual(thresholdsCrossed(pct(99), 200), [80]);
assert.deepEqual(thresholdsCrossed(pct(100) - 1, 200), [80]);
assert.deepEqual(thresholdsCrossed(pct(100), 200), [80, 100]);
assert.deepEqual(thresholdsCrossed(pct(150), 200), [80, 100]);
assert.deepEqual(thresholdsCrossed(999999, 0), [], "0 included: nothing to warn about");
console.log("ok: thresholds 79 / 80 / 99 / 100 / 150%");

// ── Who ───────────────────────────────────────────────────────────────────
const REC = { base: "reception", addons: [] };
const acct = (over: Partial<WarnAccount> = {}): WarnAccount => ({
  id: "00000000-0000-4000-8000-000000000001",
  email: "owner1@example.com",
  locale: "fr",
  paidUntil: new Date("2026-12-01T00:00:00Z"),
  subscriptionPlan: "premium",
  subscriptionStatus: "active",
  products: REC,
  ...over,
});
assert.equal(warnableAccount(acct()), true);
assert.equal(warnableAccount(acct({ products: null })), false, "grandfathered");
assert.equal(warnableAccount(acct({ products: { base: "gold", addons: [] } })), false, "invalid record");
assert.equal(warnableAccount(acct({ products: "reception" })), false, "invalid record (string)");
assert.equal(warnableAccount(acct({ subscriptionStatus: "trialing" })), false, "trial");
assert.equal(warnableAccount(acct({ subscriptionStatus: "expired" })), false, "expired");
assert.equal(warnableAccount(acct({ paidUntil: null })), false, "no fixed period");

// ── The runner over in-memory deps ────────────────────────────────────────
const P1 = new Date("2026-11-01T00:00:00Z");
const P2 = new Date("2026-12-01T00:00:00Z");
type World = {
  accounts: WarnAccount[];
  usedSeconds: Map<string, number>;
  period: Date;
  claims: Set<string>;
  sent: Array<{ to: string; input: WarningInput }>;
  events: unknown[];
  reads: number;
};
const world = (accounts: WarnAccount[]): World => ({ accounts, usedSeconds: new Map(), period: P1, claims: new Set(), sent: [], events: [], reads: 0 });
const depsOf = (w: World, env: Record<string, string> = { USAGE_WARNINGS_ENABLED: "1" }, sendOk = true): UsageWarningDeps => ({
  env,
  now: () => new Date("2026-11-20T12:00:00Z"),
  listAccounts: async () => {
    w.reads++;
    return w.accounts;
  },
  usageFor: async (a) => {
    w.reads++;
    const window = { start: w.period, end: new Date(w.period.getTime() + 30 * 86400_000) };
    const usage = usageByProduct({
      calls: [{ durationSeconds: w.usedSeconds.get(a.id) ?? 0, product: null, createdAt: new Date(w.period.getTime() + 1000) }],
      campaignCalls: [],
      window,
      entitlement: entitledProducts(a),
      catalogue: DEFAULT_PRODUCT_CATALOGUE,
      currency: a.locale === "he" ? "ILS" : "EUR",
      planMinutes: 500,
      planOverage: 1.5,
    });
    return { periodStart: window.start, usage };
  },
  claim: async (c) => {
    const k = `${c.userId}|${c.entry}|${c.threshold}|${c.periodStart.toISOString()}`;
    if (w.claims.has(k)) return false;
    w.claims.add(k);
    return true;
  },
  send: async (to, input) => {
    w.sent.push({ to, input });
    return sendOk ? { ok: true } : { ok: false, error: `provider refused ${to}` };
  },
  logEvent: async (e) => {
    w.events.push(e);
  },
});

const A = acct();
async function main() {
// reception EUR: 200 minutes included.
{
  const w = world([A]);
  const run = () => runUsageWarnings(depsOf(w));
  const seq: Array<[number, number[]]> = [
    [79, []],
    [80, [80]],
    [99, [80]],
    [100, [80, 100]],
    [150, [80, 100]],
  ];
  for (const [p, wantThresholds] of seq) {
    w.usedSeconds.set(A.id, pct(p));
    await run();
    assert.deepEqual(w.sent.map((s) => s.input.threshold), wantThresholds, `after ${p}%`);
  }
  assert.equal(w.claims.size, 2, "one claim per threshold this period");
  // A re-run at 150% sends nothing more (dedupe).
  await run();
  assert.equal(w.sent.length, 2, "dedupe within the period");
  // A new period resets.
  w.period = P2;
  w.usedSeconds.set(A.id, pct(85));
  await run();
  assert.deepEqual(w.sent.map((s) => s.input.threshold), [80, 100, 80], "new period: 80 again");
  assert.equal(w.claims.size, 3);
  assert.equal(w.sent[0].to, A.email, "the account's own address");
  assert.deepEqual(w.sent[1].input, { locale: "fr", entry: "reception", threshold: 100, usedMinutes: 200, includedMinutes: 200, overageRate: "0.39 €" });
}
// 150% on the first tick: both claimed, ONE email (for 100).
{
  const w = world([A]);
  w.usedSeconds.set(A.id, pct(150));
  const r = await runUsageWarnings(depsOf(w));
  assert.deepEqual(r, { enabled: true, accounts: 1, claimed: 2, sent: 1, failed: 0 });
  assert.deepEqual(w.sent.map((s) => s.input.threshold), [100]);
}
console.log("ok: 80 / 100 once per period, a new period resets, 150% first tick = one email");

// Flag off: nothing read, nothing claimed, nothing sent.
{
  const w = world([A]);
  w.usedSeconds.set(A.id, pct(150));
  for (const env of [{}, { USAGE_WARNINGS_ENABLED: "0" }] as Record<string, string>[]) {
    const r = await runUsageWarnings(depsOf(w, env));
    assert.deepEqual(r, { enabled: false, accounts: 0, claimed: 0, sent: 0, failed: 0 });
  }
  assert.equal(w.reads, 0, "flag off: no read");
  assert.equal(w.claims.size + w.sent.length + w.events.length, 0, "flag off: nothing");
}
console.log("ok: flag off = nothing");

// Flag ON: grandfathered / invalid / trial / unpaid at 150% → no claim, no email,
// even when the candidate list hands them over.
{
  const others = [
    acct({ id: "g1", email: "g1@example.com", products: null }),
    acct({ id: "g2", email: "g2@example.com", products: { base: "gold", addons: [] } }),
    acct({ id: "g3", email: "g3@example.com", products: { base: "reception" } }),
    acct({ id: "t1", email: "t1@example.com", subscriptionStatus: "trialing" }),
    acct({ id: "x1", email: "x1@example.com", paidUntil: null }),
  ];
  const w = world(others);
  for (const o of others) w.usedSeconds.set(o.id, pct(150));
  const r = await runUsageWarnings(depsOf(w));
  assert.deepEqual(r, { enabled: true, accounts: 0, claimed: 0, sent: 0, failed: 0 });
  assert.equal(w.claims.size + w.sent.length + w.events.length, 0, "never warned");
}
console.log("ok: flag on, grandfathered / invalid record / trial / unpaid at 150% = no claim, no email");

// Events: no address, even when the provider error quotes it.
{
  for (const sendOk of [true, false]) {
    const w = world([A]);
    w.usedSeconds.set(A.id, pct(90));
    const r = await runUsageWarnings(depsOf(w, { USAGE_WARNINGS_ENABLED: "1" }, sendOk));
    assert.equal(sendOk ? r.sent : r.failed, 1);
    assert.equal(w.events.length, 1);
    const ev = JSON.stringify(w.events);
    assert.doesNotMatch(ev, /@|example\.com/, "no address in events");
    assert.match(ev, sendOk ? /usage_warning_sent/ : /usage_warning_failed/);
  }
}
console.log("ok: no address in events");

// ── Copy: FR / HE / EN from messages/*.json ───────────────────────────────
assert.equal(warningLocale("he-IL"), "he");
assert.equal(warningLocale("en"), "en");
assert.equal(warningLocale("de"), "fr");
assert.equal(warningLocale(null), "fr");
const KEYS: WarningKey[] = ["subject80", "subject100", "heading80", "heading100", "body", "overage", "cta", "footer", "entryReception", "entrySales", "entryConnect"];
const stringsFor = (locale: WarningLocale): WarningStrings => {
  const ns = (JSON.parse(read(`messages/${locale}.json`)) as { Email: { usageWarning: Record<string, string> } }).Email.usageWarning;
  assert.deepEqual(Object.keys(ns).sort(), [...KEYS].sort(), `${locale}: exactly the keys`);
  return (key, vars) => ns[key].replace(/\{(\w+)\}/g, (_, k: string) => vars?.[k] ?? `{${k}}`);
};
const subjects = new Set<string>();
for (const locale of ["fr", "he", "en"] as const) {
  for (const threshold of [80, 100] as const) {
    const m = renderUsageWarningEmail({ locale, entry: "sales", threshold, usedMinutes: 321, includedMinutes: 400, overageRate: "1.9 ₪" }, stringsFor(locale));
    for (const part of [m.subject, m.text, m.html]) assert.doesNotMatch(part, /\{\w+\}/, `${locale} ${threshold}: no placeholder left`);
    assert.match(m.text, /321/);
    assert.match(m.text, /400/);
    assert.match(m.text, /1\.9 ₪/);
    assert.match(m.text, /dashboard\/billing/);
    assert.match(m.html, locale === "he" ? /dir="rtl"/ : /dir="ltr"/);
    assert.doesNotMatch(m.html + m.text, /resend|openai|twilio|livekit/i, "no supplier name");
    subjects.add(m.subject);
  }
}
assert.equal(subjects.size, 6, "six distinct subjects (3 locales × 2 thresholds)");
{
  const en = renderUsageWarningEmail({ locale: "en", entry: "reception", threshold: 80, usedMinutes: 160, includedMinutes: 200, overageRate: "0.39 €" }, stringsFor("en"));
  assert.equal(en.subject, "You have used 80% of your \"Receptionist\" minutes");
  const he = renderUsageWarningEmail({ locale: "he", entry: "reception", threshold: 100, usedMinutes: 200, includedMinutes: 200, overageRate: "1.5 ₪" }, stringsFor("he"));
  assert.match(he.subject, /פקידת קבלה/);
  const html = renderUsageWarningEmail({ locale: "fr", entry: "connect", threshold: 80, usedMinutes: 80, includedMinutes: 100, overageRate: "<b>" }, stringsFor("fr")).html;
  assert.ok(!html.includes("<b>") && html.includes("&lt;b&gt;"), "values are HTML-escaped");
}
console.log("ok: FR / HE / EN copy");

// ── Wiring: the cron runs it with the real deps; the sender logs no address ─
{
  const cron = read("app/api/cron/billing/route.ts");
  assert.match(cron, /runUsageWarnings\(usageWarningDeps\(\)\)/);
  assert.match(cron, /\.\.\.\(warnings\.enabled \? \{ usageWarnings: warnings \} : \{\}\)/, "flag off: the response is unchanged");
  const deps = read("lib/usage-warnings-deps.ts");
  assert.match(deps, /isNotNull\(users\.products\)/, "the query never selects a grandfathered account");
  assert.match(deps, /eq\(users\.subscriptionStatus, "active"\)/);
  assert.match(deps, /onConflictDoNothing/);
  const email = read("lib/email.ts");
  const fn = email.slice(email.indexOf("export async function sendUsageWarningEmail"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.doesNotMatch(body, /console\.\w+\([^)]*\bto\b/, "the sender never logs the recipient");
}
console.log("ALL USAGE WARNING TESTS PASSED");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
