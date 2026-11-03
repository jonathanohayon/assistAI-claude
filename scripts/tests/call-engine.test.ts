// Per-call engine resolution for the admin Monitoring cards (lib/call-engine).
// Run : npx tsx scripts/tests/call-engine.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { callPricing, engineDisplayName, resolveCallEngine } from "../../lib/call-engine";

let passed = 0;
const failures: string[] = [];
const group = (label: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`[${label}] ${e instanceof Error ? e.message : e}`);
  }
};

const ev = (event: string, metadata: Record<string, unknown> = {}) => ({ event, metadata });

group("engine on call_started wins", () => {
  const r = resolveCallEngine([
    ev("call_started", { engine: { provider: "xai", model: "grok-voice-3.0" } }),
    ev("realtime_provider", { provider: "openai", model: "gpt-realtime-2" }),
    ev("call_metrics", { usage: { model: "gpt-realtime-2" } }),
  ]);
  assert.deepStrictEqual(r, { provider: "xai", model: "grok-voice-3.0", source: "engine" });
});

group("engine only on call_metrics (late/partial group) still found", () => {
  const r = resolveCallEngine([ev("call_started"), ev("call_metrics", { engine: { provider: "gemini", model: "gemini-3.8-live" } })]);
  assert.equal(r?.model, "gemini-3.8-live");
});

group("fallback 1: realtime_provider event (calls since 2026-11-03)", () => {
  const r = resolveCallEngine([ev("call_started"), ev("realtime_provider", { provider: "gemini", model: "gemini-3.8-live" })]);
  assert.deepStrictEqual(r, { provider: "gemini", model: "gemini-3.8-live", source: "realtime_provider" });
});

group("fallback 2: usage.model on older calls is OpenAI", () => {
  const r = resolveCallEngine([ev("call_started"), ev("call_metrics", { usage: { model: "gpt-realtime", totalTokens: 1200 } })]);
  assert.deepStrictEqual(r, { provider: "openai", model: "gpt-realtime", source: "usage" });
});

group("nothing known → null (shown as —), never guessed", () => {
  assert.equal(resolveCallEngine([ev("call_started"), ev("call_ended")]), null);
  assert.equal(resolveCallEngine([ev("call_started", { engine: { provider: "xai" } })]), null, "incomplete engine");
  assert.equal(resolveCallEngine([]), null);
});

group("display names", () => {
  assert.equal(engineDisplayName({ provider: "openai", model: "gpt-realtime-2.1" }), "gpt-realtime-2.1");
  assert.equal(engineDisplayName({ provider: "xai", model: "grok-voice-3.0" }), "Grok Voice 3.0");
  assert.equal(engineDisplayName({ provider: "gemini", model: "gemini-3.8-live" }), "Gemini 3.8 Live");
  assert.equal(engineDisplayName({ provider: "xai", model: "grok-voice-latest" }), "Grok Voice Latest");
});

group("pricing mode", () => {
  assert.equal(callPricing([ev("call_metrics", { usage: { pricing: "per_minute", costUsd: 0.16 } })]), "per_minute");
  assert.equal(callPricing([ev("call_metrics", { usage: { pricing: "tokens" } })]), "tokens");
  assert.equal(callPricing([ev("call_metrics", { usage: {} })]), null);
});

group("no supplier name literals in the module (it ships in tenant bundles)", () => {
  // Comments are stripped from production bundles, so only code counts.
  const src = readFileSync(resolve(__dirname, "../../lib/call-engine.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(src, /Grok|Gemini|grok-voice|gemini-3/, "derive display names from the model id instead");
});

console.log(`call-engine: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error("  ✗", f);
  process.exit(1);
}
