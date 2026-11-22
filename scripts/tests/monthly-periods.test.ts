// The shared monthly split (lib/monthly-periods.ts), as tables:
//   1. monthlySubPeriods: month ends, February, 31st starts, leap years,
//      contiguity, clipping, at most twelve; billingPeriodsOf (overage
//      billing) returns exactly the same spans;
//   2. monthlySubPeriodAt: the sub-period containing now, [start, end),
//      clamped before / after;
//   3. usageWindowFor: only an annual PAID window changes; monthly, trial and
//      expired windows come back as the same object (unchanged);
//      the anchor is the paid annual coverage containing now;
//   4. usage warnings over the real runner with usageWindowFor: an annual
//      account at 80 % in month 1 and again in month 2 → two warnings; the
//      same month twice → one.
// The month steps use local wall-clock time (addPeriod), so the whole file
// runs once per time zone: UTC, Europe/Paris, Asia/Jerusalem (it re-spawns
// itself with TZ set). Mock data only (example.com).
// Run with:  npx tsx scripts/tests/monthly-periods.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ZONES = ["UTC", "Europe/Paris", "Asia/Jerusalem"];
if (!process.env.MONTHLY_PERIODS_TZ_CHILD) {
  for (const tz of ZONES) {
    const r = spawnSync("tsx", [fileURLToPath(import.meta.url)], { stdio: "inherit", env: { ...process.env, TZ: tz, MONTHLY_PERIODS_TZ_CHILD: "1" } });
    if (r.error) throw r.error;
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  console.log(`ALL MONTHLY PERIODS TESTS PASSED (${ZONES.join(", ")})`);
  process.exit(0);
}

const TZ = process.env.TZ ?? "";

async function main() {
  const { addPeriod } = await import("../../lib/billing-activation");
  const { monthlySubPeriods, monthlySubPeriodAt, usageWindowFor } = await import("../../lib/monthly-periods");
  const { billingPeriodsOf } = await import("../../lib/order-lines");
  const { DEFAULT_PRODUCT_CATALOGUE } = await import("../../lib/product-catalogue");
  const { entitledProducts } = await import("../../lib/product-entitlement");
  const { usageByProduct } = await import("../../lib/usage-by-product");
  const { runUsageWarnings } = await import("../../lib/usage-warnings");
  type Span = { start: Date; end: Date };

  // Local wall-clock dates (month is 1-based here for readability).
  const L = (y: number, m: number, d: number, h = 10, min = 30) => new Date(y, m - 1, d, h, min);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const starts = (ps: Span[]) => ps.map((p) => fmt(p.start));

  // ── 1. monthlySubPeriods ───────────────────────────────────────────────
  const table: Array<{ name: string; start: Date; want: string[] }> = [
    {
      name: "1st of the month",
      start: L(2026, 1, 1),
      want: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map((m) => `2026-${m}-01 10:30`),
    },
    {
      name: "15th, crossing a year end",
      start: L(2025, 11, 15),
      want: ["2025-11-15", "2025-12-15", "2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15", "2026-05-15", "2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15", "2026-10-15"].map((d) => `${d} 10:30`),
    },
    {
      // Jan 31 + 1 month overflows into March (setMonth), and every later
      // step chains from the previous boundary: the split overage billing
      // has always used (#389), kept verbatim.
      name: "31st start, non-leap year",
      start: L(2027, 1, 31),
      want: ["2027-01-31", "2027-03-03", "2027-04-03", "2027-05-03", "2027-06-03", "2027-07-03", "2027-08-03", "2027-09-03", "2027-10-03", "2027-11-03", "2027-12-03", "2028-01-03"].map((d) => `${d} 10:30`),
    },
    {
      name: "31st start, leap year",
      start: L(2028, 1, 31),
      want: ["2028-01-31", "2028-03-02", "2028-04-02", "2028-05-02", "2028-06-02", "2028-07-02", "2028-08-02", "2028-09-02", "2028-10-02", "2028-11-02", "2028-12-02", "2029-01-02"].map((d) => `${d} 10:30`),
    },
    {
      name: "Feb 28 start (non-leap)",
      start: L(2027, 2, 28),
      want: ["2027-02-28", "2027-03-28", "2027-04-28", "2027-05-28", "2027-06-28", "2027-07-28", "2027-08-28", "2027-09-28", "2027-10-28", "2027-11-28", "2027-12-28", "2028-01-28"].map((d) => `${d} 10:30`),
    },
    {
      name: "Feb 29 start (leap year)",
      start: L(2028, 2, 29),
      want: ["2028-02-29", "2028-03-29", "2028-04-29", "2028-05-29", "2028-06-29", "2028-07-29", "2028-08-29", "2028-09-29", "2028-10-29", "2028-11-29", "2028-12-29", "2029-01-29"].map((d) => `${d} 10:30`),
    },
    {
      name: "30th start, through February",
      start: L(2026, 10, 30),
      want: ["2026-10-30", "2026-11-30", "2026-12-30", "2027-01-30", "2027-03-02", "2027-04-02", "2027-05-02", "2027-06-02", "2027-07-02", "2027-08-02", "2027-09-02", "2027-10-02"].map((d) => `${d} 10:30`),
    },
    {
      // Across both DST changes in Paris / Jerusalem: the wall-clock time
      // stays, whatever the zone.
      name: "midnight start, across DST",
      start: L(2026, 3, 1, 0, 0),
      want: ["03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map((m) => `2026-${m}-01 00:00`).concat(["2027-01-01 00:00", "2027-02-01 00:00"]),
    },
  ];
  for (const t of table) {
    const end = addPeriod(t.start, "annual");
    const ps = monthlySubPeriods(t.start, end);
    assert.deepEqual(starts(ps), t.want, `${TZ} ${t.name}: starts`);
    assert.ok(ps.length <= 12, `${TZ} ${t.name}: at most twelve`);
    assert.equal(ps[0].start.getTime(), t.start.getTime(), `${TZ} ${t.name}: first starts at the period start`);
    assert.equal(ps[ps.length - 1].end.getTime(), end.getTime(), `${TZ} ${t.name}: last ends at (clipped to) the period end`);
    for (let i = 1; i < ps.length; i++) assert.equal(ps[i].start.getTime(), ps[i - 1].end.getTime(), `${TZ} ${t.name}: contiguous at ${i}`);
    for (const p of ps) assert.ok(p.start.getTime() < p.end.getTime(), `${TZ} ${t.name}: non-empty`);
    // Overage billing splits an annual coverage with the very same function.
    const billed = billingPeriodsOf({ start: t.start, end, period: "annual", base: "reception", addons: [] });
    assert.deepEqual(billed.map((p) => [p.start.getTime(), p.end.getTime()]), ps.map((p) => [p.start.getTime(), p.end.getTime()]), `${TZ} ${t.name}: billingPeriodsOf is monthlySubPeriods`);
  }
  // A short period: clipped; empty / inverted: nothing.
  {
    const s = L(2026, 5, 10);
    const e = L(2026, 6, 20);
    assert.deepEqual(monthlySubPeriods(s, e).map((p) => [fmt(p.start), fmt(p.end)]), [["2026-05-10 10:30", "2026-06-10 10:30"], ["2026-06-10 10:30", "2026-06-20 10:30"]], `${TZ} short period clipped`);
    assert.deepEqual(monthlySubPeriods(s, s), [], `${TZ} empty period`);
    assert.deepEqual(monthlySubPeriods(e, s), [], `${TZ} inverted period`);
  }
  console.log(`ok [${TZ}]: monthlySubPeriods table (month ends, Feb, 31st starts, leap year, DST) = billingPeriodsOf`);

  // ── 2. monthlySubPeriodAt ──────────────────────────────────────────────
  {
    const s = L(2027, 1, 31);
    const e = addPeriod(s, "annual");
    const at = (now: Date) => {
      const p = monthlySubPeriodAt(s, e, now);
      return p ? fmt(p.start) : null;
    };
    assert.equal(at(s), "2027-01-31 10:30", "the start itself: first month");
    assert.equal(at(new Date(L(2027, 3, 3).getTime() - 1)), "2027-01-31 10:30", "1 ms before a boundary: previous month");
    assert.equal(at(L(2027, 3, 3)), "2027-03-03 10:30", "on a boundary: the new month ([start, end))");
    assert.equal(at(L(2027, 7, 15)), "2027-07-03 10:30", "mid-year");
    assert.equal(at(new Date(e.getTime() - 1)), "2028-01-03 10:30", "last ms: last month");
    assert.equal(at(e), "2028-01-03 10:30", "at the end: clamped to the last month");
    assert.equal(at(L(2030, 1, 1)), "2028-01-03 10:30", "after: clamped to the last month");
    assert.equal(at(L(2020, 1, 1)), "2027-01-31 10:30", "before: clamped to the first month");
    assert.equal(monthlySubPeriodAt(s, s, s), null, "empty period: null");
    // Every instant of the year falls in exactly one sub-period.
    const subs = monthlySubPeriods(s, e);
    for (let t = s.getTime(); t < e.getTime(); t += 37 * 3600_000 + 1234) {
      const hits = subs.filter((p) => p.start.getTime() <= t && t < p.end.getTime());
      assert.equal(hits.length, 1, `exactly one sub-period at ${new Date(t).toISOString()}`);
      assert.deepEqual(monthlySubPeriodAt(s, e, new Date(t)), hits[0]);
    }
  }
  console.log(`ok [${TZ}]: monthlySubPeriodAt picks [start, end), clamps outside`);

  // ── 3. usageWindowFor ──────────────────────────────────────────────────
  {
    const end = L(2027, 9, 15);
    const start = L(2026, 9, 15);
    const now = L(2026, 11, 20);
    const paid = { start, end, kind: "paid" as const };
    // Annual paid, no coverage: anchored on the paid window.
    const w = usageWindowFor({ window: paid, period: "annual", now });
    assert.deepEqual([fmt(w.start), fmt(w.end), w.kind], ["2026-11-15 10:30", "2026-12-15 10:30", "paid"], "annual: this month");
    // Monthly, trial, expired, unknown period: the same object (unchanged).
    const monthly = { start: L(2026, 10, 15), end: L(2026, 11, 15), kind: "paid" as const };
    assert.equal(usageWindowFor({ window: monthly, period: "monthly", now }), monthly, "monthly: unchanged");
    assert.equal(usageWindowFor({ window: monthly, period: null, now }), monthly, "no period (monthly default): unchanged");
    const trial = { start: L(2026, 11, 19), end: L(2026, 11, 21), kind: "trial" as const };
    assert.equal(usageWindowFor({ window: trial, period: "annual", now }), trial, "trial: unchanged");
    const expired = { start: L(2026, 9, 15), end: L(2026, 10, 15), kind: "expired" as const };
    assert.equal(usageWindowFor({ window: expired, period: "annual", now }), expired, "expired: unchanged");
    // A monthly account with a coverage: still unchanged.
    assert.equal(usageWindowFor({ window: monthly, period: "monthly", coverages: [{ start: L(2026, 10, 14), end: L(2026, 11, 14), period: "monthly" }], now }), monthly);
    // Anchored on the paid annual coverage containing now (the billed
    // bounds), not on the paid window: e.g. a Feb 29 coverage start, where
    // paidUntil - 1 year is Mar 1.
    const covStart = L(2028, 2, 29);
    const covEnd = addPeriod(covStart, "annual");
    const fromEnd = { start: new Date(covEnd.getTime()), end: covEnd, kind: "paid" as const };
    fromEnd.start.setFullYear(fromEnd.start.getFullYear() - 1); // what currentPeriodWindow derives
    const nowLeap = L(2028, 3, 15);
    const anchored = usageWindowFor({ window: fromEnd, period: "annual", coverages: [{ start: covStart, end: covEnd, period: "annual" }], now: nowLeap });
    const billedNow = billingPeriodsOf({ start: covStart, end: covEnd, period: "annual", base: "reception", addons: [] }).find((p) => p.start <= nowLeap && nowLeap < p.end)!;
    assert.deepEqual([anchored.start.getTime(), anchored.end.getTime()], [billedNow.start.getTime(), billedNow.end.getTime()], "coverage anchor = the billed month");
    // Several coverages (an early renewal): the one containing now; a monthly
    // coverage or one not containing now is ignored.
    const c1 = { start: L(2026, 1, 10), end: L(2027, 1, 10), period: "annual" as const };
    const c2 = { start: L(2027, 1, 10), end: L(2028, 1, 10), period: "annual" as const };
    const stacked = { start: L(2027, 1, 10), end: L(2028, 1, 10), kind: "paid" as const }; // paidUntil - 1 year = c2
    const inC1 = usageWindowFor({ window: stacked, period: "annual", coverages: [{ start: L(2026, 6, 1), end: L(2026, 7, 1), period: "monthly" }, c2, c1], now: L(2026, 6, 20) });
    assert.deepEqual([fmt(inC1.start), fmt(inC1.end)], ["2026-06-10 10:30", "2026-07-10 10:30"], "early renewal: the coverage containing now");
  }
  console.log(`ok [${TZ}]: usageWindowFor: annual paid → this month (coverage anchor), monthly / trial / expired unchanged`);

  // ── 4. Usage warnings per monthly sub-period ───────────────────────────
  {
    const covStart = L(2026, 1, 31);
    const covEnd = addPeriod(covStart, "annual");
    const coverages = [{ start: covStart, end: covEnd, period: "annual" as const }];
    const account = {
      id: "00000000-0000-4000-8000-0000000000a1",
      email: "annual@example.com",
      locale: "en",
      paidUntil: covEnd,
      subscriptionPlan: "global",
      subscriptionStatus: "active",
      products: { base: "reception", addons: [] },
    };
    const included = DEFAULT_PRODUCT_CATALOGUE.reception.EUR.minutes;
    const at80 = Math.floor(included * 60 * 0.8);
    type Call = { durationSeconds: number; product: string | null; createdAt: Date };
    const callsLog: Call[] = [];
    const claims = new Set<string>();
    const sent: number[] = [];
    let clock = L(2026, 2, 10);
    const deps = {
      env: { USAGE_WARNINGS_ENABLED: "1" },
      now: () => clock,
      listAccounts: async () => [account],
      usageFor: async (_a: unknown, now: Date) => {
        const paidWindow = { start: new Date(covEnd.getTime()), end: covEnd, kind: "paid" as const };
        paidWindow.start.setFullYear(paidWindow.start.getFullYear() - 1);
        const window = usageWindowFor({ window: paidWindow, period: "annual", coverages, now });
        const usage = usageByProduct({
          calls: callsLog,
          campaignCalls: [],
          window,
          entitlement: entitledProducts(account),
          catalogue: DEFAULT_PRODUCT_CATALOGUE,
          currency: "EUR",
          planMinutes: 0,
          planOverage: 0,
        });
        return { periodStart: window.start, usage };
      },
      claim: async (c: { userId: string; entry: string; threshold: number; periodStart: Date }) => {
        const k = `${c.userId}|${c.entry}|${c.threshold}|${c.periodStart.toISOString()}`;
        if (claims.has(k)) return false;
        claims.add(k);
        return true;
      },
      send: async (_to: string, input: { threshold: number }) => {
        sent.push(input.threshold);
        return { ok: true };
      },
      logEvent: async () => undefined,
    };
    // Month 1 ([Jan 31, Mar 3)): 80 % of the MONTHLY included minutes.
    callsLog.push({ durationSeconds: at80, product: null, createdAt: L(2026, 2, 5) });
    await runUsageWarnings(deps);
    assert.deepEqual(sent, [80], "month 1 at 80 %: one warning");
    // The same month again (more runs, later in the month): nothing more.
    clock = L(2026, 3, 2);
    await runUsageWarnings(deps);
    await runUsageWarnings(deps);
    assert.deepEqual(sent, [80], "same month twice: still one warning");
    // Month 2 ([Mar 3, Apr 3)): month 1's usage no longer counts...
    clock = L(2026, 3, 10);
    await runUsageWarnings(deps);
    assert.deepEqual(sent, [80], "month 2 starts at 0 %: month 1's minutes are not carried over");
    // ...and 80 % again in month 2 → a second warning.
    callsLog.push({ durationSeconds: at80, product: null, createdAt: L(2026, 3, 12) });
    await runUsageWarnings(deps);
    assert.deepEqual(sent, [80, 80], "month 2 at 80 %: a second warning");
    await runUsageWarnings(deps);
    assert.deepEqual(sent, [80, 80], "month 2 again: no third");
    assert.deepEqual(
      [...claims].map((k) => k.split("|")[3]).sort(),
      [covStart.toISOString(), L(2026, 3, 3).toISOString()].sort(),
      "claims keyed on each month's start (the billed periodStart)",
    );
    // A whole-year window would have compared 2 × 80 % with ONE month's minutes.
    const yearly = usageByProduct({
      calls: callsLog, campaignCalls: [], window: { start: covStart, end: covEnd },
      entitlement: entitledProducts(account), catalogue: DEFAULT_PRODUCT_CATALOGUE, currency: "EUR", planMinutes: 0, planOverage: 0,
    });
    assert.ok(yearly.kind === "products" && yearly.entries[0].usedSeconds === 2 * at80, "control: the year sums both months");
  }
  console.log(`ok [${TZ}]: annual warnings: one per threshold per monthly sub-period`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
