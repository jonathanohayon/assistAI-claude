// Unit tests for lib/rate-limit.ts.
// Run with:  npx tsx scripts/tests/rate-limit.test.ts

import assert from "node:assert/strict";

import { clientIp, createRateLimiter } from "../../lib/rate-limit";

// allows up to the limit inside a window, then refuses
{
  const rl = createRateLimiter({ limit: 3, windowMs: 1000 });
  assert.deepEqual([1, 2, 3, 4].map(() => rl.hit("ip", 0)), [true, true, true, false]);
  // a new window resets the count
  assert.equal(rl.hit("ip", 1000), true);
}

// keys are independent
{
  const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(rl.hit("a", 0), true);
  assert.equal(rl.hit("b", 0), true);
  assert.equal(rl.hit("a", 1), false);
}

// a flood of distinct keys cannot grow memory past maxKeys (fails closed)
{
  const rl = createRateLimiter({ limit: 5, windowMs: 1000, maxKeys: 2 });
  assert.equal(rl.hit("a", 0), true);
  assert.equal(rl.hit("b", 0), true);
  assert.equal(rl.hit("c", 0), false);
  // once windows expire, new keys get room again
  assert.equal(rl.hit("c", 1000), true);
}

// takes the first X-Forwarded-For hop
assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
assert.equal(clientIp(new Headers()), "unknown");

console.log("ALL RATE-LIMIT TESTS PASSED");
