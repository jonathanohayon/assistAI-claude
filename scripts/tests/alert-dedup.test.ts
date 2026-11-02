// Unit tests for lib/alert-dedup.ts.
// Run with:  npx tsx scripts/tests/alert-dedup.test.ts

import assert from "node:assert/strict";

import { recordAlert, shouldSendAlert } from "../../lib/alert-dedup";

const H = 3_600_000;

// first alert for a key goes out
assert.equal(shouldSendAlert({}, "openai_key_invalid", 0, 24 * H), true);

// THE POINT: thousands of identical errors inside the window send nothing more
{
  let ledger = recordAlert({}, "realtime_fatal:invalid_api_key", 0, 7 * 24 * H);
  let sent = 0;
  for (let i = 1; i <= 137_470; i++) {
    if (shouldSendAlert(ledger, "realtime_fatal:invalid_api_key", i * 600, 6 * H)) {
      sent++;
      ledger = recordAlert(ledger, "realtime_fatal:invalid_api_key", i * 600, 7 * 24 * H);
    }
  }
  // 137,470 errors over ~23 h with a 6 h window → only a handful of re-alerts
  assert.ok(sent <= 4, `sent ${sent}`);
}

// keys are independent
{
  const ledger = recordAlert({}, "a", 0, 7 * 24 * H);
  assert.equal(shouldSendAlert(ledger, "b", 1, H), true);
  assert.equal(shouldSendAlert(ledger, "a", 1, H), false);
  assert.equal(shouldSendAlert(ledger, "a", H, H), true);
}

// old entries are pruned
{
  const ledger = recordAlert({ old: 0 }, "new", 10 * 24 * H, 7 * 24 * H);
  assert.deepEqual(Object.keys(ledger), ["new"]);
}

console.log("ALL ALERT-DEDUP TESTS PASSED");
