// Pins the agent_configs columns served to the worker by the inbound payload
// (lib/agent/session-config/inbound.ts: /api/agent/config phone/web and
// /api/agent/session-config phone/web/call_me — the voice-route-snapshot
// shapes inboundDefault / inboundProfile / inboundWeb). The handler spreads
// the row, so a NEW column rides along unless it is hidden: every column must
// be in exactly one of the two lists below, or this test fails.
// Run with:  npx tsx scripts/tests/worker-runtime-config.test.ts

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";

import { getTableColumns } from "drizzle-orm";

import { accountFrom } from "../../lib/agent/adapters";
import { WORKER_HIDDEN_CONFIG_COLUMNS, workerRuntimeConfig } from "../../lib/agent/worker-runtime-config";
import { accountProductTrials, agentConfigs, calls, usageWarnings, users } from "../../lib/db/schema";

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
  "contactConfirmations",
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
const row = Object.fromEntries(
  columns.map((c) => [
    c,
    c === "ownerRecapEmail"
      ? "owner@example.com"
      : c === "contactConfirmations"
        ? { owner_whatsapp: { value: "+15550000099", state: "confirmed", at: "2026-11-15T00:00:00.000Z", by: "code" } }
        : `mock-${c}`,
  ]),
) as unknown as Parameters<typeof workerRuntimeConfig>[0];
const served = workerRuntimeConfig(row);
assert.deepEqual(Object.keys(served), SERVED, "served keys pinned");
for (const k of NEVER_SERVED) assert.ok(!(k in served), `${k} never served`);
assert.ok(!JSON.stringify(served).includes("owner@example.com"), "the owner recap address is never served");
assert.ok(!JSON.stringify(served).includes("+15550000099"), "the confirmation record is never served");
assert.ok("ownerRecapEmail" in row, "the input row is not mutated");

// The inbound handler goes through the helper and spreads no other row.
const src = readFileSync(new URL("../../lib/agent/session-config/inbound.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
assert.match(src, /const \{ updatedAt, \.\.\.runtime \} = workerRuntimeConfig\(config\);/);
assert.doesNotMatch(src, /\.\.\.(config|tenant\.config)\b/, "no raw spread of the config row");

// agentState (dashboard hero) is NEVER a worker-facing key: not a column the
// helper could serve, not in the served payload, and no worker-facing handler
// or /api/agent/* route mentions it (code only, comments stripped). The
// inbound handler only exports the dry-run effects agentState uses.
assert.ok(!columns.includes("agentState"), "agentState is not an agent_configs column");
assert.ok(!("agentState" in served), "agentState never served");
{
  const code = (u: URL) => readFileSync(u, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const files: URL[] = [];
  const walk = (dir: URL) => {
    for (const name of readdirSync(dir)) {
      const u = new URL(name, dir);
      if (statSync(u).isDirectory()) walk(new URL(`${name}/`, dir));
      else if (/\.tsx?$/.test(name)) files.push(u);
    }
  };
  walk(new URL("../../lib/agent/session-config/", import.meta.url));
  walk(new URL("../../app/api/agent/", import.meta.url));
  assert.ok(files.length >= 10, "worker-facing files found");
  for (const f of files) {
    assert.doesNotMatch(code(f), /agentState|agent-state/, `${f.pathname} must not reference agentState`);
  }
}

// users columns that must NEVER reach a worker payload. The handlers read
// the users row field by field (tenant.user.<field>; accountFrom picks its
// fields), never spread it; these columns must not be read at all by
// worker-facing code.
//   door — dashboard presentation only (lib/door.ts, migration 0054).
//   products — billing entitlement only (lib/products.ts, migration 0055).
const USERS_NEVER_SERVED = ["door", "products", "salesEngineOverride"];
{
  const userColumns = Object.keys(getTableColumns(users));
  for (const c of USERS_NEVER_SERVED) assert.ok(userColumns.includes(c), `users.${c} exists`);
  const user = Object.fromEntries(userColumns.map((c) => [c, `mock-${c}`])) as unknown as Parameters<typeof accountFrom>[0] & Record<string, unknown>;
  user.door = "connect";
  user.companySheet = null;
  const cfgRow = { ...(row as unknown as Record<string, unknown>), forwardingVerifiedAt: null, business: null, knowledge: null };
  for (const cfg of [null, cfgRow as unknown as Parameters<typeof accountFrom>[1]]) {
    const acct = accountFrom(user, cfg) as unknown as Record<string, unknown>;
    for (const c of USERS_NEVER_SERVED) {
      assert.ok(!(c in acct), `users.${c} never in the account settings`);
      assert.ok(!JSON.stringify(acct).includes(`mock-${c}`), `users.${c} value never served`);
    }
    assert.ok(!JSON.stringify(acct).includes("connect"), "the door value never served");
  }
  const code = (u: URL) => readFileSync(u, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const files: URL[] = [];
  const walk = (dir: URL) => {
    for (const name of readdirSync(dir)) {
      const u = new URL(name, dir);
      if (statSync(u).isDirectory()) walk(new URL(`${name}/`, dir));
      else if (/\.tsx?$/.test(name)) files.push(u);
    }
  };
  walk(new URL("../../lib/agent/", import.meta.url));
  walk(new URL("../../app/api/agent/", import.meta.url));
  files.push(new URL("../../lib/tenant.ts", import.meta.url), new URL("../../lib/tenant-resolution.ts", import.meta.url));
  for (const f of files) {
    const src = code(f);
    assert.doesNotMatch(src, /\bdoor\b|lib\/door/, `${f.pathname} must not read the door`);
    assert.doesNotMatch(src, /\.products\b|lib\/products|lib\/product-/, `${f.pathname} must not read the account's products`);
    assert.doesNotMatch(src, /\.\.\.(user|tenant\.user|u)\b/, `${f.pathname} must not spread a users row`);
    // E2b: read only by the sales decision (lib/engine-override-load.ts).
    assert.doesNotMatch(src, /salesEngineOverride|sales_engine_override|getClientSalesOverride/, `${f.pathname} must not read the client sales override`);
  }
}

// calls.product and usage_warnings (P2, migration 0056) are billing only:
// worker-facing code never reads them (the payload snapshot in
// scripts/products-usage-db.sh proves it on real rows, NULL vs set).
{
  assert.ok("product" in getTableColumns(calls), "calls.product exists");
  assert.ok("entry" in getTableColumns(usageWarnings), "usage_warnings exists");
  assert.ok("minutesIncluded" in getTableColumns(accountProductTrials), "account_product_trials exists");
  const code = (u: URL) => readFileSync(u, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const files: URL[] = [];
  const walk = (dir: URL) => {
    for (const name of readdirSync(dir)) {
      const u = new URL(name, dir);
      if (statSync(u).isDirectory()) walk(new URL(`${name}/`, dir));
      else if (/\.tsx?$/.test(name)) files.push(u);
    }
  };
  walk(new URL("../../lib/agent/", import.meta.url));
  walk(new URL("../../app/api/agent/", import.meta.url));
  for (const f of files) {
    const src = code(f);
    assert.doesNotMatch(src, /calls\.product|usageWarnings|usage_warnings|usage-by-product|products-usage|usage-warnings|call-product/, `${f.pathname} must not read billing usage`);
    // P3 (migration 0057): per-product trials are billing only too.
    assert.doesNotMatch(src, /accountProductTrials|account_product_trials|product-trials|product-trial-caps|sales-trial-/, `${f.pathname} must not read per-product trials`);
  }
}

console.log("ALL WORKER-RUNTIME-CONFIG TESTS PASSED");
