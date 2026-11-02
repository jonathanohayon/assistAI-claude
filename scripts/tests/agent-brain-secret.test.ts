// Unit tests for nextBrainSecret (lib/agent-brain.ts).
// Run with:  npx tsx scripts/tests/agent-brain-secret.test.ts

import assert from "node:assert/strict";

import { nextBrainSecret } from "../../lib/agent-brain";

const gen = () => "generated";

// THE BUG: a save without a secret (the dashboard never sends one) keeps the existing secret
assert.equal(nextBrainSecret({ existing: "s1", provided: undefined, enabled: true, generate: gen }), "s1");
assert.equal(nextBrainSecret({ existing: "s1", provided: "  ", enabled: true, generate: gen }), "s1");

// enabling the external agent without any secret generates one
assert.equal(nextBrainSecret({ existing: undefined, provided: undefined, enabled: true, generate: gen }), "generated");

// an explicit secret wins
assert.equal(nextBrainSecret({ existing: "s1", provided: " mine ", enabled: true, generate: gen }), "mine");

// a disabled brain with no secret stays without one
assert.equal(nextBrainSecret({ existing: undefined, provided: undefined, enabled: false, generate: gen }), undefined);

// the default generator yields 48 hex chars
assert.match(nextBrainSecret({ existing: undefined, provided: undefined, enabled: true })!, /^[0-9a-f]{48}$/);

console.log("ALL AGENT-BRAIN-SECRET TESTS PASSED");
