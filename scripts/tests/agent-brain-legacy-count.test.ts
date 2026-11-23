// The old own-agent mechanism, for the admins:
//   1. enabledLegacyBrainCount(map): how many accounts still have it on
//      (a count only);
//   2. the daily digest line, shown only when N > 0, through the existing
//      daily_digest alert (deduped 20 h);
//   3. the overlap guard (lib/agent/legacy-brain-overlap.ts): old mechanism on
//      AND the new client agent set → one admin alert per account per day,
//      no PII, FAIL-OPEN (never throws, never awaited on the call path).
// The payload byte-identity with the alert path throwing runs against a real
// Postgres in scripts/tests/engine-override-db.test.ts (section 7).
// Mock data only, no network, no DB.
// Run with:  npx tsx scripts/tests/agent-brain-legacy-count.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { enabledLegacyBrainCount, type AgentBrain } from "../../lib/agent-brain";
import {
  alertLegacyBrainOverlapSafely,
  legacyAndClientAgentBothSet,
  legacyBrainOverlapAlertKey,
} from "../../lib/agent/legacy-brain-overlap";
import { formatDigest, legacyBrainDigestLine, type DigestInput } from "../../lib/monitoring-rules";

const ROOT = new URL("../../", import.meta.url).pathname;
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SAFE = "https://agent.example.test/hook";
const NEW = "https://new.example.test/agent";
type Entry = Partial<AgentBrain>;
type AlertArgs = { key: string; subject: string; body: string; dedupMs: number; severity?: string };

async function main() {
  // ── 1. enabledLegacyBrainCount ─────────────────────────────────────────
  assert.equal(enabledLegacyBrainCount({}), 0);
  assert.equal(enabledLegacyBrainCount(null), 0);
  assert.equal(enabledLegacyBrainCount(undefined), 0);
  assert.equal(enabledLegacyBrainCount([{ enabled: true }]), 0, "an array is not a map");
  assert.equal(enabledLegacyBrainCount("nope"), 0);
  assert.equal(
    enabledLegacyBrainCount({
      "u-1": { enabled: true, url: SAFE },
      "u-2": { enabled: false, url: SAFE },
      "u-3": { enabled: true, url: "" }, // stored on, even without an address
      "u-4": { enabled: "true" as unknown as boolean }, // only a real true counts
      "u-5": null as unknown as Entry,
      "u-6": {},
    }),
    2,
  );

  // ── 2. The digest line: count only, shown only when N > 0 ──────────────
  const base: DigestInput = {
    calls: 3, callSeconds: 120, bookings: 1, errors: 0, topErrors: [], heartbeatAgeMin: 2, synthetic: null,
  };
  const line = legacyBrainDigestLine(2);
  assert.equal(line, "Ancien mécanisme « votre agent » : 2 compte(s) encore activé(s)");
  assert.equal(formatDigest(base), formatDigest({ ...base, legacyBrainEnabled: 0 }), "N = 0: no line, digest unchanged");
  assert.doesNotMatch(formatDigest(base), /votre agent/);
  const withLine = formatDigest({ ...base, legacyBrainEnabled: 2 });
  assert.equal(withLine, `${formatDigest(base)}\n${line}`, "the line is appended, nothing else changes");
  assert.equal(line.replace(/\d+/g, "N"), "Ancien mécanisme « votre agent » : N compte(s) encore activé(s)", "fixed text + the count");
  assert.doesNotMatch(withLine, /https?:|@|u-\d/);
  {
    const mon = src("lib/monitoring.ts");
    const run = mon.slice(mon.indexOf("export async function runDailyDigest"));
    assert.match(run, /const legacyBrainEnabled = await countEnabledLegacyBrains\(\)\.catch\(\(\) => 0\);/, "a read failure never blocks the digest");
    assert.match(run, /formatDigest\(\{[\s\S]*legacyBrainEnabled,\s*\}\)/);
    assert.match(run, /key: "daily_digest",[\s\S]*dedupMs: 20 \* HOUR,/, "deduped as before");
    assert.doesNotMatch(mon, /getAgentBrain|tenant_agent_brain/, "only the count leaves the brain map");
    assert.match(
      src("lib/agent-brain.ts"),
      /export async function countEnabledLegacyBrains\(\): Promise<number> \{\s*return enabledLegacyBrainCount\(await readMap\(\)\);\s*\}/,
    );
  }

  // ── 3. The overlap guard ───────────────────────────────────────────────
  const caOn = { enabled: true, url: NEW };
  assert.equal(legacyAndClientAgentBothSet({ enabled: true }, caOn), true);
  assert.equal(legacyAndClientAgentBothSet({ enabled: false }, caOn), false, "old off");
  assert.equal(legacyAndClientAgentBothSet({ enabled: true }, { enabled: false, url: NEW }), false, "new off");
  assert.equal(legacyAndClientAgentBothSet({ enabled: true }, { enabled: true, url: "  " }), false, "new without a url");
  assert.equal(legacyAndClientAgentBothSet(null, caOn), false);
  assert.equal(legacyAndClientAgentBothSet({ enabled: true }, undefined), false);

  // Once per account per day: a mock ledger honouring key + dedupMs, as alertAdmins does.
  const ledger = new Map<string, number>();
  const sent: AlertArgs[] = [];
  let now = Date.UTC(2026, 10, 23, 10);
  const ledgerSink = async (a: AlertArgs) => {
    const last = ledger.get(a.key);
    if (last !== undefined && now - last < a.dedupMs) return false;
    ledger.set(a.key, now);
    sent.push(a);
    return true;
  };
  const brain = { enabled: true, url: SAFE, secret: "mock-secret-xyz" };
  const tools = { enabled: true, url: NEW, secret: "mock-ca-secret" };
  for (let i = 0; i < 3; i++) {
    assert.equal(await alertLegacyBrainOverlapSafely({ userId: "u-1", brain, clientAgent: tools, alert: ledgerSink }), true);
  }
  await alertLegacyBrainOverlapSafely({ userId: "u-2", brain, clientAgent: tools, alert: ledgerSink });
  assert.deepEqual(sent.map((a) => a.key), [legacyBrainOverlapAlertKey("u-1"), legacyBrainOverlapAlertKey("u-2")], "one per account");
  now += 24 * 3600_000;
  await alertLegacyBrainOverlapSafely({ userId: "u-1", brain, clientAgent: tools, alert: ledgerSink });
  assert.equal(sent.length, 3, "again the next day");
  assert.equal(sent[0].dedupMs, 24 * 3600_000);
  assert.equal(sent[0].severity, "warning");
  // No PII: no url, no secret, no email; the internal account id only.
  for (const a of sent) {
    const text = `${a.key}\n${a.subject}\n${a.body}`;
    assert.doesNotMatch(text, /example\.test|https?:|mock-secret|mock-ca-secret|@/);
  }
  assert.match(sent[0].body, /silently ignored/);
  // No overlap → the sink is never called.
  {
    let calls = 0;
    const r = await alertLegacyBrainOverlapSafely({ userId: "u-3", brain: { enabled: false }, clientAgent: tools, alert: async () => (calls++, true) });
    assert.equal(r, false);
    assert.equal(calls, 0);
  }
  // Fail-open: a sink throwing synchronously or rejecting never propagates.
  const syncThrow = ((() => {
    throw new Error("mock sink down (sync)");
  }) as unknown) as (a: AlertArgs) => Promise<unknown>;
  const rejects = async () => {
    throw new Error("mock sink down (async)");
  };
  assert.equal(await alertLegacyBrainOverlapSafely({ userId: "u-1", brain, clientAgent: tools, alert: syncThrow }), false);
  assert.equal(await alertLegacyBrainOverlapSafely({ userId: "u-1", brain, clientAgent: tools, alert: rejects }), false);
  // ... nor a malformed input
  assert.equal(
    await alertLegacyBrainOverlapSafely({ userId: "u-1", brain: { get enabled(): boolean { throw new Error("mock"); } }, clientAgent: tools, alert: ledgerSink }),
    false,
  );

  // ── The inbound path: fire-and-forget, after both fields are computed ──
  {
    const inbound = src("lib/agent/session-config/inbound.ts");
    const call = inbound.indexOf("void alertLegacyBrainOverlapSafely({");
    assert.ok(call > 0, "called with void (never awaited, never delays the config)");
    assert.ok(inbound.indexOf("const brain = await getAgentBrain(") < call);
    assert.ok(inbound.indexOf("let clientAgentField =") < call);
    assert.ok(call < inbound.indexOf("return NextResponse.json({\n    ...runtime,"));
    assert.match(
      inbound,
      /void alertLegacyBrainOverlapSafely\(\{\s*userId: tenant\.user\.id,\s*brain,\s*clientAgent: tools\.clientAgent,\s*alert: fx\.alertAdmins,\s*\}\);/,
    );
    assert.equal(inbound.match(/alertLegacyBrainOverlapSafely/g)?.length, 2, "import + one call; its result is never used");
  }

  console.log("agent-brain-legacy-count: all assertions passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
