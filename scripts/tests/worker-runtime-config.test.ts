// Pins the agent_configs columns served to the worker by the inbound payload
// (lib/agent/session-config/inbound.ts: /api/agent/config phone/web and
// /api/agent/session-config phone/web/call_me — the voice-route-snapshot
// shapes inboundDefault / inboundProfile / inboundWeb). The handler spreads
// the row, so a NEW column rides along unless it is hidden: every column must
// be in exactly one of the two lists below, or this test fails.
// Run with:  npx tsx scripts/tests/worker-runtime-config.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getTableColumns } from "drizzle-orm";

import { WORKER_HIDDEN_CONFIG_COLUMNS, workerRuntimeConfig } from "../../lib/agent/worker-runtime-config";
import { agentConfigs } from "../../lib/db/schema";

// Served today (main), in row order. Adding a column here is a decision:
// the worker will receive it.
const SERVED = [
  "instructions",
  "greetingInstructions",
  "agentName",
  "model",
  "voice",
  "temperature",
  "speed",
  "maxResponseTokens",
  "ownerWhatsapp",
  "transferNumber",
  "aiDisclosureEnabled",
  "aiDisclosureText",
  "ownerDigestEnabled",
  "forwardingTestStartedAt",
  "forwardingBusinessPhone",
  "forwardingDetectedAt",
  "forwardingVerifiedMethod",
  "forwardingVerifiedAt",
  "primaryLanguage",
  "reminderEnabled",
  "inheritAdminGlobals",
  "personality",
  "noiseReductionLevel",
  "voiceConfig",
  "realtimeProvider",
  "voiceProfile",
  "knowledge",
  "business",
  "updatedAt",
];

// Must NEVER be served to the worker.
const NEVER_SERVED = [
  "id",
  "userId",
  "personaConfig",
  "toolsConfig",
  "transferNumberParked",
  "ownerRecapEmail",
  "ownerRecapEmailEnabled",
];

const columns = Object.keys(getTableColumns(agentConfigs));
for (const c of columns) {
  assert.ok(
    SERVED.includes(c) !== NEVER_SERVED.includes(c),
    `agent_configs.${c} must be in exactly one list (SERVED or NEVER_SERVED) of this test`,
  );
}
assert.deepEqual([...WORKER_HIDDEN_CONFIG_COLUMNS].sort(), [...NEVER_SERVED].sort(), "the helper hides exactly NEVER_SERVED");

// A full row (every column set) → exactly SERVED, in row order.
const row = Object.fromEntries(columns.map((c) => [c, c === "ownerRecapEmail" ? "owner@example.com" : `mock-${c}`])) as unknown as Parameters<typeof workerRuntimeConfig>[0];
const served = workerRuntimeConfig(row);
assert.deepEqual(Object.keys(served), SERVED, "served keys pinned");
for (const k of NEVER_SERVED) assert.ok(!(k in served), `${k} never served`);
assert.ok(!JSON.stringify(served).includes("owner@example.com"), "the owner recap address is never served");
assert.ok("ownerRecapEmail" in row, "the input row is not mutated");

// The inbound handler goes through the helper and spreads no other row.
const src = readFileSync(new URL("../../lib/agent/session-config/inbound.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
assert.match(src, /const \{ updatedAt, \.\.\.runtime \} = workerRuntimeConfig\(config\);/);
assert.doesNotMatch(src, /\.\.\.(config|tenant\.config)\b/, "no raw spread of the config row");

console.log("ALL WORKER-RUNTIME-CONFIG TESTS PASSED");
