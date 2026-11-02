// Unit tests for demoRegisterDirective (lib/demo-register.ts).
// Run with:  npx tsx scripts/tests/demo-register.test.ts

import assert from "node:assert/strict";

import { demoRegisterDirective } from "../../lib/demo-register";

// French demo: feminine agreement and formal "vous", greeting included
const fr = demoRegisterDirective("fr");
assert.match(fr, /ravie/);
assert.match(fr, /vous/);
assert.match(fr, /jamais/);

// Hebrew demo: feminine first person
assert.match(demoRegisterDirective("he"), /feminine/);

// English has no gendered first person or formal you: nothing to add
assert.equal(demoRegisterDirective("en"), "");
assert.equal(demoRegisterDirective("xx"), "");

console.log("ALL DEMO-REGISTER TESTS PASSED");
