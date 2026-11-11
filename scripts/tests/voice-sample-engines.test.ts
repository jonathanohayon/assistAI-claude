// Unit tests for lib/voice/sample-engines.ts: key status by variable NAME
// (never a value) and ready counts per engine.
// Run with:  npx tsx scripts/tests/voice-sample-engines.test.ts
import assert from "node:assert/strict";

import { sampleEngineStatus, sampleKeyStatus } from "../../lib/voice/sample-engines";

const SECRET = "sk-SUPER-SECRET-value-123";
const env = { OPENAI_API_KEY: SECRET, GEMINI_API_KEY: `${SECRET}-g`, XAI_API_KEY: "  " };

// Which variable the render path actually reads (first one set wins).
assert.deepEqual(sampleKeyStatus("openai", env), { keySet: true, env: "OPENAI_API_KEY" });
assert.deepEqual(sampleKeyStatus("gemini", env), { keySet: true, env: "GEMINI_API_KEY" }, "GOOGLE_API_KEY unset → the fallback in use");
assert.deepEqual(sampleKeyStatus("gemini", { GOOGLE_API_KEY: "x" }), { keySet: true, env: "GOOGLE_API_KEY" });
assert.deepEqual(sampleKeyStatus("gemini", {}), { keySet: false, env: "GOOGLE_API_KEY" }, "missing → the one to set");
assert.deepEqual(sampleKeyStatus("xai", env), { keySet: false, env: "XAI_API_KEY" }, "blank counts as missing");

// Ready counts.
const s = sampleEngineStatus(
  [
    { voiceId: "marin", style: "warm", language: "fr" },
    { voiceId: "voice-226", style: "warm", language: "fr" },
    { voiceId: "voice-226", style: "warm", language: "he" },
    { voiceId: "voice-309", style: "warm", language: "fr" },
    { voiceId: "voice-309", style: "warm", language: "he" }, // not in Grok's plan (no Hebrew)
    { voiceId: "unknown", style: "warm", language: "fr" },
  ],
  env,
);
assert.deepEqual(
  { o: [s.openai.ready, s.openai.total], g: [s.gemini.ready, s.gemini.total], x: [s.xai.ready, s.xai.total] },
  { o: [1, 72], g: [2, 18], x: [1, 12] },
);

// NEVER a value in the response (any part of any key).
const json = JSON.stringify(s);
for (const v of [SECRET, `${SECRET}-g`, "SUPER-SECRET", "sk-"]) assert.ok(!json.includes(v), `leaks ${v}`);
for (const e of Object.values(s)) assert.deepEqual(Object.keys(e).sort(), ["env", "keySet", "ready", "total"]);

console.log("ALL VOICE-SAMPLE-ENGINES TESTS PASSED");
