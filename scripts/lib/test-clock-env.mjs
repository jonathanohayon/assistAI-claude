// For a DB test that starts a child process with a hand-built env: the
// variables that carry the suite's injected clock (scripts/lib/test-clock.sh)
// into it. Empty when the suite runs in real time.
export function clockEnv(env = process.env) {
  const out = {};
  if (env.DB_TEST_CLOCK_OFFSET_MS) out.DB_TEST_CLOCK_OFFSET_MS = env.DB_TEST_CLOCK_OFFSET_MS;
  if (env.DB_TEST_CLOCK_OFFSET_MS && env.NODE_OPTIONS) out.NODE_OPTIONS = env.NODE_OPTIONS;
  return out;
}
