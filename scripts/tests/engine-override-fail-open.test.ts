// The engine override decision is FAIL-OPEN on every call path (E2 fix):
//   1. each failure point inside decide* (the catalogue row read, the
//      entitlement read, the engine-languages read) → decideEngineSafely
//      returns apply: false and attempts exactly ONE fail-open alert
//      (key engine_override_decision_failed:<product>, 24 h dedup);
//   2. the alert sink throwing on top → still apply: false, nothing propagates;
//   3. the ignored-override alert throwing → the decision result stands;
//   4. source guard: the three handlers call decide* only through the wrapper.
// The handlers' byte-identical responses are proven in the DB suite
// (scripts/tests/engine-override-db.test.ts, section 5).
// Mock data only. Run with:  npx tsx scripts/tests/engine-override-fail-open.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DEFAULT_ENGINE_LANGUAGES, type EngineLanguages } from "../../lib/engine-languages";
import { noEngineOverrides, type EngineOverrides } from "../../lib/engine-override";
import {
  decideEngineSafely,
  decideInboundEngine,
  decideSalesEngine,
  engineDecisionFailedAlertKey,
  engineIgnoredAlertKey,
  type DecideDeps,
  type EngineAlert,
} from "../../lib/engine-override-load";

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const DAY_MS = 24 * 60 * 60 * 1000;
const USER = "00000000-0000-4000-8000-0000000000aa";
const CONFIG = { realtimeProvider: null, model: "gpt-realtime-2", primaryLanguage: "en" };
const IN_TODAY = { engine: "openai" as const, model: "gpt-realtime-2" };
const OUT_TODAY = { engine: "openai" as const, model: "gpt-realtime" };

class CatalogueReadError extends Error {}
class EntitlementReadError extends Error {}
class LanguagesReadError extends Error {}
class AlertSinkError extends Error {}

const withOverrides = (o: Partial<EngineOverrides>): DecideDeps["overrides"] => async () => ({ ...noEngineOverrides(), ...o });
const ALL_SET = withOverrides({ reception: { engine: "xai", model: null }, sales: { engine: "openai", model: "gpt-realtime-2.1" } });
const ok: Required<DecideDeps> = {
  overrides: ALL_SET!,
  entitled: async () => ["reception"],
  languages: async () => DEFAULT_ENGINE_LANGUAGES,
};

type Call = Parameters<EngineAlert>[0];
const recorder = (fail = false) => {
  const calls: Call[] = [];
  const alert: EngineAlert = async (a) => {
    calls.push(a);
    if (fail) throw new AlertSinkError("mock sink down");
    return true;
  };
  return { calls, alert };
};

// The three call paths, each run through the safe wrapper exactly as its handler does.
const paths = {
  inbound: (alert: EngineAlert, deps: DecideDeps) =>
    decideEngineSafely(() => decideInboundEngine(USER, CONFIG, alert, deps), { path: "inbound", alert, today: IN_TODAY }),
  campaign: (alert: EngineAlert, deps: DecideDeps) =>
    decideEngineSafely(() => decideSalesEngine("campaign", USER, "fr", OUT_TODAY, alert, deps), { path: "campaign", alert, today: OUT_TODAY }),
  outbound_test: (alert: EngineAlert, deps: DecideDeps) =>
    decideEngineSafely(() => decideSalesEngine("outbound_test", USER, "fr", OUT_TODAY, alert, deps), { path: "outbound_test", alert, today: OUT_TODAY }),
} as const;

async function main() {
  // Sanity: with every read working, the override applies on each path.
  for (const [name, run] of Object.entries(paths)) {
    const { calls, alert } = recorder();
    const r = await run(alert, ok);
    assert.equal(r.decision.apply, true, `${name}: the override applies when nothing fails`);
    assert.equal(calls.length, 0, `${name}: no alert when nothing fails`);
  }

  // ── 1 + 2. Each failure point → apply false + one fail-open alert ──────
  const failures: Array<[string, DecideDeps, Array<keyof typeof paths>]> = [
    ["catalogue row read", { ...ok, overrides: async () => { throw new CatalogueReadError("mock"); } }, ["inbound", "campaign", "outbound_test"]],
    // accountProducts is read on the inbound path only (sales has one product).
    ["accountProducts", { ...ok, entitled: async () => { throw new EntitlementReadError("mock"); } }, ["inbound"]],
    ["engine-languages read", { ...ok, languages: async () => { throw new LanguagesReadError("mock"); } }, ["inbound", "campaign", "outbound_test"]],
  ];
  for (const [point, deps, on] of failures) {
    for (const name of on) {
      const family = name === "inbound" ? "reception" : "sales";
      const today = name === "inbound" ? IN_TODAY : OUT_TODAY;
      // The sink working.
      {
        const { calls, alert } = recorder();
        const r = await paths[name](alert, deps);
        assert.equal(r.decision.apply, false, `${point} on ${name}: apply false`);
        assert.equal(r.product, null, `${point} on ${name}: no product`);
        assert.deepEqual({ engine: r.decision.engine, servedModel: r.decision.servedModel }, { engine: today.engine, servedModel: today.model }, `${point} on ${name}: today's engine`);
        assert.equal(calls.length, 1, `${point} on ${name}: exactly one fail-open alert attempted`);
        assert.equal(calls[0].key, engineDecisionFailedAlertKey(family));
        assert.equal(calls[0].key, `engine_override_decision_failed:${family}`);
        assert.equal(calls[0].dedupMs, DAY_MS, "deduplicated over 24 h like the ignored-override alert");
        assert.doesNotMatch(calls[0].body + calls[0].subject, new RegExp(`${USER}|mock`), "no account id, no error message: the class only");
        assert.match(calls[0].body, /Error\)/, "the error class is named");
      }
      // The sink throwing on top: still apply false, nothing propagates.
      {
        const { calls, alert } = recorder(true);
        const r = await paths[name](alert, deps);
        assert.equal(r.decision.apply, false, `${point} on ${name} + sink down: apply false`);
        assert.equal(calls.length, 1, `${point} on ${name} + sink down: one attempt`);
      }
    }
  }
  console.log("ok: every failure point → apply false + one fail-open alert (and the sink throwing on top is swallowed)");

  // ── 3. The ignored-override alert throwing: the decision stands ────────
  {
    // Inbound: Grok does not speak Hebrew → ignored (apply false) + the ignored alert.
    const he = { ...CONFIG, primaryLanguage: "he" };
    const { calls, alert } = recorder(true);
    const r = await decideEngineSafely(() => decideInboundEngine(USER, he, alert, ok), { path: "inbound", alert, today: IN_TODAY });
    const ref = await decideInboundEngine(USER, he, async () => true, ok);
    assert.deepEqual(r, ref, "inbound: the decision is the same as with a working sink");
    assert.equal(r.decision.apply, false);
    assert.equal(r.decision.ignored?.reason, "language");
    assert.deepEqual(calls.map((c) => c.key), [engineIgnoredAlertKey(USER, "reception")], "only the ignored alert, no fail-open alert");
  }
  {
    // Sales: languages where OpenAI speaks no French → ignored on a fr call.
    const noFr: EngineLanguages = { ...DEFAULT_ENGINE_LANGUAGES, openai: { "*": ["en"] } };
    const deps = { ...ok, languages: async () => noFr };
    for (const p of ["campaign", "outbound_test"] as const) {
      const { calls, alert } = recorder(true);
      const r = await paths[p](alert, deps);
      const ref = await decideSalesEngine(p, USER, "fr", OUT_TODAY, async () => true, deps);
      assert.deepEqual(r, ref, `${p}: the decision is the same as with a working sink`);
      assert.equal(r.decision.apply, false);
      assert.equal(r.decision.ignored?.reason, "language");
      assert.deepEqual(calls.map((c) => c.key), [engineIgnoredAlertKey(USER, "sales")], `${p}: only the ignored alert`);
    }
  }
  console.log("ok: the ignored-override alert throwing never changes the decision");

  // ── 4. Source guard: decide* only through the safe wrapper ─────────────
  for (const f of ["lib/agent/session-config/inbound.ts", "lib/agent/session-config/campaign.ts", "lib/agent/session-config/outbound-test.ts"]) {
    const c = code(f);
    const bare = (c.match(/decide(Inbound|Sales)Engine\s*\(/g) ?? []).length;
    const wrapped = (c.match(/decideEngineSafely\(\s*\(\) => decide(Inbound|Sales)Engine\s*\(/g) ?? []).length;
    assert.equal(bare, 1, `${f}: one decide* call`);
    assert.equal(wrapped, bare, `${f}: every decide* call goes through decideEngineSafely`);
    assert.doesNotMatch(c, /engineForCall\s*\(/, `${f}: no direct engineForCall`);
  }
  console.log("ok: source guard (handlers call decide* only through decideEngineSafely)");
  console.log("ALL ENGINE-OVERRIDE FAIL-OPEN TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
