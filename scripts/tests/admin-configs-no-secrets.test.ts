// GET /api/admin/configs/[userId] never sends a secret column to the admin's
// browser: no password hash, no HYP card token, no Google refresh token, no
// sealed tools secret, nor any future column whose NAME looks secret.
//
// The route's own handler (handleAdminConfigGet) runs on mock rows in which
// EVERY column of `users` and `agent_configs` is filled with a sentinel; the
// JSON it returns must hold no secret column name and no secret sentinel. The
// secret list is derived from lib/db/schema.ts by name, so a column added
// later is checked without editing this file. Mock values only.
// The secret list and its rules live in scripts/tests/lib/admin-route-harness.ts,
// shared with admin-routes-no-secrets.test.ts (every admin route, driven).
// Run with:  npx tsx scripts/tests/admin-configs-no-secrets.test.ts

import { EXPLICIT_SECRETS, secretColumns } from "./lib/admin-route-harness";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableColumns, type Column } from "drizzle-orm";

import { ADMIN_USER_FIELDS, handleAdminConfigGet } from "../../lib/admin/tenant-config-view";
import { agentConfigs, users } from "../../lib/db/schema";

const ROOT = new URL("../../", import.meta.url).pathname;
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

type Columns = Record<string, Column>;

const USER_COLS = getTableColumns(users) as unknown as Columns;
const CONFIG_COLS = getTableColumns(agentConfigs) as unknown as Columns;
const SECRETS = secretColumns([USER_COLS, CONFIG_COLS]);

// ── The secret list is real ─────────────────────────────────────────────
assert.ok(SECRETS.length > 0, "the secret list is not empty");
for (const name of ["passwordHash", "hypToken", "hypTokenExp", "googleRefreshToken"]) {
  assert.ok(SECRETS.includes(name), `${name} is a secret column`);
}
for (const name of EXPLICIT_SECRETS) {
  assert.ok(name in USER_COLS || name in CONFIG_COLS, `${name} still exists in the schema (else update the explicit list)`);
}

// ── Guard: a future column matching the pattern is caught automatically ──
const future = { ...USER_COLS, stripeApiKey: { name: "stripe_api_key" } as Column };
assert.ok(secretColumns([future, CONFIG_COLS]).includes("stripeApiKey"), "a new *Key column is a secret with no edit here");
const futureSnake = { ...CONFIG_COLS, webhookPepper: { name: "webhook_pepper" } as Column };
assert.ok(secretColumns([USER_COLS, futureSnake]).includes("webhookPepper"), "a new *pepper column is a secret");
// The pick is not a denylist: a column it does not name is never sent.
for (const f of ADMIN_USER_FIELDS) assert.ok(!SECRETS.includes(f), `picked user field ${f} is not secret`);

// ── Mock rows: EVERY column filled with a sentinel ─────────────────────
const secretSentinel = (prop: string) => `SENTINEL-SECRET-${prop}-9f3a`;
const plainSentinel = (prop: string) => `sentinel-${prop}`;

function sentinelRow(cols: Columns): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [prop, col] of Object.entries(cols)) {
    const secret = SECRETS.includes(prop);
    const s = secret ? secretSentinel(prop) : plainSentinel(prop);
    switch (col.dataType) {
      case "number":
        row[prop] = 7;
        break;
      case "boolean":
        row[prop] = true;
        break;
      case "date":
        row[prop] = new Date(Date.UTC(2026, 10, 16, 9, 0, 0));
        break;
      case "json":
        // A jsonb record carrying the sentinel inside (e.g. a sealed secret).
        row[prop] = secret ? { nested: { secret: s, sealed: `v1:${s}` } } : {};
        break;
      default:
        row[prop] = s;
    }
  }
  return row;
}

const USER_ROW = sentinelRow(USER_COLS);
const CONFIG_ROW = sentinelRow(CONFIG_COLS);
// Every secret column got a sentinel (so a leak is visible in the JSON).
for (const name of SECRETS) {
  assert.ok(JSON.stringify({ ...USER_ROW, ...CONFIG_ROW }).includes(secretSentinel(name)), `${name} is filled with a sentinel`);
}

async function run() {
  const calls: string[] = [];
  const res = await handleAdminConfigGet("user-mock-1", {
    // The loader returns the WHOLE row: the handler itself must pick.
    loadUser: async (id) => (calls.push(`user:${id}`), USER_ROW as never),
    loadConfig: async (id) => (calls.push(`config:${id}`), CONFIG_ROW as never),
    voiceChoice: async () => ({ selected: "mock-voice" }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(calls, ["user:user-mock-1", "config:user-mock-1"]);
  const json = JSON.stringify(res.body);

  // ── No secret column name and no secret sentinel anywhere ──────────────
  for (const name of SECRETS) {
    assert.ok(!json.includes(`"${name}"`), `no "${name}" key in the response`);
    assert.ok(!json.includes(secretSentinel(name)), `no ${name} value in the response`);
  }
  assert.ok(!json.includes("SENTINEL-SECRET-"), "no secret sentinel at all");

  // ── The user part is exactly the pick; the config keeps its fields ─────
  const body = res.body as { user: Record<string, unknown>; config: Record<string, unknown> };
  assert.deepEqual(Object.keys(body.user).sort(), [...ADMIN_USER_FIELDS].sort(), "user = ADMIN_USER_FIELDS, nothing more");
  for (const f of ADMIN_USER_FIELDS) if (f !== "door") assert.deepEqual(body.user[f], USER_ROW[f], `user.${f} is served as stored`);
  assert.equal(body.user.door, "reception", "an unknown stored door is served resolved");
  for (const prop of Object.keys(CONFIG_COLS)) {
    if (SECRETS.includes(prop) || prop === "transferNumberParked") continue;
    assert.ok(prop in body.config, `config.${prop} is still served`);
  }
  assert.ok("voiceConfig" in body.config && "personaConfig" in body.config && "voiceChoice" in body.config);
  assert.equal(body.config.maxResponseTokens, 7, "maxResponseTokens (a setting) is still served");

  // ── Not found / no config ────────────────────────────────────────────
  const missing = await handleAdminConfigGet("nobody", {
    loadUser: async () => null,
    loadConfig: async () => assert.fail("no config read for a missing user"),
    voiceChoice: async () => null,
  });
  assert.deepEqual(missing, { status: 404, body: { error: "not found" } });
  const noCfg = await handleAdminConfigGet("user-mock-1", {
    loadUser: async () => USER_ROW as never,
    loadConfig: async () => null,
    voiceChoice: async () => null,
  });
  assert.equal((noCfg.body as { config: unknown }).config, null);
  assert.ok(!JSON.stringify(noCfg.body).includes("SENTINEL-SECRET-"));
}

// ── Static: the route goes through the handler, the loader picks too ────
const route = src("app/api/admin/configs/[userId]/route.ts").replace(/\/\/.*$/gm, "");
const getBody = route.slice(route.indexOf("export async function GET("), route.indexOf("export async function PUT("));
assert.match(getBody, /handleAdminConfigGet\(userId, adminConfigGetDeps\)/, "GET uses the handler");
assert.doesNotMatch(getBody, /\.from\(users\)|\.\.\.user\b|user,/, "GET reads no whole users row itself");
const deps = src("lib/admin/tenant-config-deps.ts").replace(/\/\/.*$/gm, "");
assert.match(deps, /\.select\(adminUserColumns\)\.from\(users\)/, "the users query selects the pick only");
assert.doesNotMatch(deps, /\.select\(\)\.from\(users\)/, "no whole users row is loaded");

run().then(
  () => console.log("ALL ADMIN-CONFIGS-NO-SECRETS TESTS PASSED"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
