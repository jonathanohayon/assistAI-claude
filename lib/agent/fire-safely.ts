// Fire-and-forget side effects on the call path (admin alerts, marks).
// `void fx.alertAdmins(...)` only ignores the returned promise: a sink that
// throws SYNCHRONOUSLY still throws out of the handler and fails the whole
// session config. fireSafely catches both a sync throw and a rejection, so a
// side effect can never change nor fail the payload.

/**
 * Runs run() (the arguments are built inside it, so they are covered too).
 * Never throws, never rejects. Resolves true when the call returned /
 * resolved, false when it threw or rejected (for tests).
 */
export async function fireSafely(run: () => unknown): Promise<boolean> {
  try {
    await run();
    return true;
  } catch {
    // Fail-open: the call payload never depends on this side effect.
    return false;
  }
}
