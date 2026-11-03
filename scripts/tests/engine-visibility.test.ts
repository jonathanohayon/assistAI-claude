// Tenants never see which engine / supplier took a call (lib/engine-visibility.ts).
// Run with:  npx tsx scripts/tests/engine-visibility.test.ts

import assert from "node:assert/strict";

import { eventsForViewer, stripEngineFromMetadata } from "../../lib/engine-visibility";

const rows = [
  { id: 1, event: "call_started", message: "Session démarrée", metadata: { origin: { kind: "sip" } } },
  { id: 2, event: "config_loaded", message: "Config chargée : grok-voice-3.0 / eve", metadata: {} },
  { id: 3, event: "realtime_provider", message: "Realtime provider: xai", metadata: { engine: { provider: "xai", model: "grok-voice-3.0" } } },
  {
    id: 4,
    event: "call_metrics",
    message: "TTFA 434ms",
    metadata: {
      engine: { provider: "xai", model: "grok-voice-3.0" },
      usage: { provider: "xai", model: "grok-voice-3.0", costUsd: 0.12, pricing: "per_minute" },
      topology: { openai: "us-realtime" },
      ttfaMs: { mean: 434 },
    },
  },
  { id: 5, event: "openai_usage", message: "usage", metadata: { model: "gpt-realtime-2" } },
  { id: 6, event: "realtime_fatal_error", message: "OpenAI Realtime fatal", metadata: {} },
];

// admin: everything, untouched
assert.deepEqual(eventsForViewer(rows, true), rows);

// tenant: supplier events dropped, engine/model/topology stripped, cost kept
const tenant = eventsForViewer(rows, false);
assert.deepEqual(tenant.map((r) => r.id), [1, 4]);
const metrics = tenant.find((r) => r.id === 4)!.metadata as Record<string, unknown>;
assert.equal("engine" in metrics, false);
assert.equal("topology" in metrics, false);
assert.deepEqual(metrics.usage, { costUsd: 0.12, pricing: "per_minute" });
assert.deepEqual(metrics.ttfaMs, { mean: 434 });
// no supplier string anywhere in what a tenant receives
const json = JSON.stringify(tenant);
for (const s of ["grok", "xai", "gemini", "openai", "gpt-realtime"]) {
  assert.equal(json.toLowerCase().includes(s), false, `tenant payload must not contain "${s}"`);
}

// robust to odd metadata
assert.equal(stripEngineFromMetadata(null), null);
assert.deepEqual(stripEngineFromMetadata({ usage: "x", a: 1 }), { usage: "x", a: 1 });

console.log("ALL ENGINE-VISIBILITY TESTS PASSED");
