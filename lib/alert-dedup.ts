// Pure dedup rule for admin alerts. Unit-tested in
// scripts/tests/alert-dedup.test.ts.

/** key → epoch ms of the last alert sent for it. */
export type AlertLedger = Record<string, number>;

export function shouldSendAlert(
  ledger: AlertLedger,
  key: string,
  now: number,
  dedupMs: number,
): boolean {
  const last = ledger[key];
  return typeof last !== "number" || now - last >= dedupMs;
}

/** Records a send and drops entries older than `keepMs` so the ledger stays small. */
export function recordAlert(
  ledger: AlertLedger,
  key: string,
  now: number,
  keepMs: number,
): AlertLedger {
  const next: AlertLedger = {};
  for (const [k, t] of Object.entries(ledger)) {
    if (typeof t === "number" && now - t < keepMs) next[k] = t;
  }
  next[key] = now;
  return next;
}
