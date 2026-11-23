// Call-path side effects can never fail the session config:
//   1. fireSafely (lib/agent/fire-safely.ts) catches a SYNC throw and a
//      rejection (a bare `void fn()` only ignores the returned promise);
//   2. alertLegacyBrainOverlapSafely still never throws through it;
//   3. source guard: no bare `void fx.…(` / `void alert…(` left in the
//      session-config handlers; every `void` there goes through fireSafely
//      or a *Safely helper.
// The inbound payload byte-identity with a throwing unsafe_agent_webhook sink
// runs against a real Postgres in scripts/tests/engine-override-db.test.ts
// (section 8). Mock data only, no network, no DB.
// Run with:  npx tsx scripts/tests/call-path-fire-safely.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { fireSafely } from "../../lib/agent/fire-safely";
import { alertLegacyBrainOverlapSafely } from "../../lib/agent/legacy-brain-overlap";

const ROOT = new URL("../../", import.meta.url).pathname;

async function main() {
  // 1. fireSafely
  const syncThrow = (): Promise<unknown> => {
    throw new Error("mock sink down (sync)");
  };
  const rejects = async () => {
    throw new Error("mock sink down (async)");
  };
  let calls = 0;
  const ok = async () => {
    calls++;
    return true;
  };
  assert.equal(await fireSafely(syncThrow), false, "sync throw → false, no throw");
  assert.equal(await fireSafely(rejects), false, "rejection → false, no rejection");
  assert.equal(await fireSafely(ok), true, "resolved → true");
  assert.equal(calls, 1);
  assert.equal(await fireSafely(() => undefined), true, "a sync, non-promise return is fine");
  // A throw while building the arguments (inside the thunk) is caught too.
  assert.equal(
    await fireSafely(() => Promise.resolve((null as unknown as { x: string }).x)),
    false,
    "arguments built inside the thunk are covered",
  );
  // `void fireSafely(syncThrow)` itself never throws synchronously.
  assert.doesNotThrow(() => void fireSafely(syncThrow));
  console.log("ok: fireSafely catches sync throws and rejections");

  // 2. the overlap helper keeps #418's behaviour through fireSafely
  const both = {
    userId: "u-mock",
    brain: { enabled: true },
    clientAgent: { enabled: true, url: "https://new.example.test/agent" },
  };
  assert.equal(await alertLegacyBrainOverlapSafely({ ...both, alert: syncThrow }), false);
  assert.equal(await alertLegacyBrainOverlapSafely({ ...both, alert: rejects }), false);
  assert.equal(await alertLegacyBrainOverlapSafely({ ...both, alert: async () => true }), true);
  assert.equal(
    await alertLegacyBrainOverlapSafely({ ...both, brain: { enabled: false }, alert: syncThrow }),
    false,
    "no overlap → the sink is not called",
  );
  console.log("ok: overlap alert unchanged (sync throw / rejection swallowed)");

  // 3. source guard over the session-config handlers
  const dir = join(ROOT, "lib/agent/session-config");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  assert.ok(files.includes("inbound.ts") && files.includes("campaign.ts") && files.includes("outbound-test.ts"));
  for (const f of files) {
    const code = readFileSync(join(dir, f), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    assert.doesNotMatch(code, /\bvoid\s+fx\./, `${f}: no bare \`void fx.…(\``);
    assert.doesNotMatch(code, /\bvoid\s+alert(?!\w*Safely\b)\w*\s*\(/, `${f}: no bare \`void alert…(\``);
    for (const m of code.matchAll(/\bvoid\s+([\w.]+)\s*\(/g)) {
      assert.match(m[1], /^(fireSafely|\w+Safely)$/, `${f}: \`void ${m[1]}(\` must go through fireSafely`);
    }
  }
  console.log(`ok: source guard (${files.length} session-config handlers, no bare fire-and-forget)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
