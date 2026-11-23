// Node side of the DB suites' injected clock (see scripts/lib/test-clock.sh).
// Loaded into every Node process of a DB suite through
// NODE_OPTIONS=--import=<this file>. With DB_TEST_CLOCK_OFFSET_MS unset,
// empty or 0 it does nothing (the default: real time).
//
// With an offset, the global Date reads `real time + offset`:
//   - Date.now() and `new Date()` (no argument) are shifted;
//   - `Date()` called as a function returns the shifted time as a string;
//   - `new Date(x)` with an argument, Date.parse, Date.UTC and every
//     prototype method are untouched (they never read the clock);
//   - `instanceof Date` still holds; performance.now / process.hrtime are
//     NOT shifted (monotonic durations stay real).
// The clock keeps ADVANCING from the pinned start (it is an offset, not a
// frozen value): suites measure durations, wait on TTLs and order rows by
// creation time, which a frozen clock would break. The same offset is applied
// to the suite's throwaway Postgres (now(), clock_timestamp(), ...), so JS Date
// and SQL now() agree to within the time it takes to run a query.
const raw = process.env.DB_TEST_CLOCK_OFFSET_MS;
const offset = raw ? Number(raw) : 0;
if (raw && !Number.isFinite(offset)) {
  throw new Error(`test-clock: DB_TEST_CLOCK_OFFSET_MS is not a number: ${raw}`);
}
if (offset !== 0 && !globalThis.__testClockInstalled) {
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  const now = () => realNow() + offset;
  const ShiftedDate = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      return Reflect.construct(target, args.length === 0 ? [now()] : args, newTarget === ShiftedDate ? target : newTarget);
    },
    apply() {
      return new RealDate(now()).toString();
    },
    get(target, prop, receiver) {
      if (prop === "now") return now;
      return Reflect.get(target, prop, receiver);
    },
  });
  globalThis.Date = ShiftedDate;
  Object.defineProperty(globalThis, "__testClockInstalled", { value: true });
}
