// The monthly sub-periods of a paid period. PURE (no lib/db, no network, no
// clock), table-tested in scripts/tests/monthly-periods.test.ts.
//
// The catalogue's included minutes are per MONTH. An annual period is
// therefore twelve monthly sub-periods, and EVERY place that measures usage
// against the catalogue minutes uses the same split:
//   - overage billing (lib/order-lines.ts billingPeriodsOf / computeOverageLines);
//   - the billing-stats usageByProduct display and the 80/100 % usage
//     warnings (usageWindowFor below), for accounts with a products record.
// One function, so the bill, the dashboard and the warnings cannot disagree
// on where a month starts.
//
// The months are stepped with addPeriod (local wall-clock setMonth, as every
// other period bound in the app), each step from the previous boundary, and
// the last one is clipped to the period's end.

import { addPeriod } from "./billing-activation";

export type Span = { start: Date; end: Date };

/**
 * The monthly sub-periods of [start, end): at most twelve, contiguous, the
 * first starting at `start`, the last ending at (clipped to) `end`.
 */
export function monthlySubPeriods(start: Date, end: Date): Span[] {
  const out: Span[] = [];
  let s = start;
  for (let i = 0; i < 12 && s.getTime() < end.getTime(); i++) {
    const next = addPeriod(s, "monthly");
    const e = next.getTime() > end.getTime() ? end : next;
    out.push({ start: s, end: e });
    s = e;
  }
  return out;
}

/**
 * The monthly sub-period of [start, end) that contains `now`
 * (sub.start <= now < sub.end). Clamped: before the period → the first one,
 * at or after its end → the last one. null only for an empty period.
 */
export function monthlySubPeriodAt(start: Date, end: Date, now: Date): Span | null {
  const subs = monthlySubPeriods(start, end);
  if (subs.length === 0) return null;
  const t = now.getTime();
  return subs.find((p) => p.start.getTime() <= t && t < p.end.getTime()) ?? (t < subs[0].start.getTime() ? subs[0] : subs[subs.length - 1]);
}

/** A period paid by a multi-line order (its base line's bounds). */
export type CoverageSpan = Span & { period: "monthly" | "annual" };

/**
 * The usage window of an account WITH a products record (display and
 * warnings). Only an annual PAID window changes: it becomes the current
 * monthly sub-period. The anchor is the paid annual coverage containing
 * `now` when there is one (the exact bounds overage billing splits), else
 * the paid window itself. Anything else (monthly, trial, expired) is
 * returned as is, the same object.
 */
export function usageWindowFor<W extends Span & { kind: string }>(opts: {
  window: W;
  period: "monthly" | "annual" | null;
  coverages?: readonly CoverageSpan[];
  now: Date;
}): W {
  const { window, now } = opts;
  if (window.kind !== "paid" || opts.period !== "annual") return window;
  const t = now.getTime();
  const anchor =
    (opts.coverages ?? []).find((c) => c.period === "annual" && c.start.getTime() <= t && t < c.end.getTime()) ?? window;
  const sub = monthlySubPeriodAt(anchor.start, anchor.end, now);
  return sub ? { ...window, start: sub.start, end: sub.end } : window;
}
