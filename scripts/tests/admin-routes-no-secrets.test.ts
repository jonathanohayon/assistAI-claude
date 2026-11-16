// No admin route sends a secret column. Every app/api/admin/**/route.ts is
// found by a filesystem walk (a new route is covered without editing this
// file), imported for real, and EVERY exported handler is called as the mock
// admin (session + internal secret) against a fake database whose rows have
// every column filled with a sentinel (scripts/tests/lib/admin-route-harness.ts).
// No response may hold a secret column name or a secret sentinel; the secret
// list is derived from lib/db/schema.ts by name (users + agent_configs).
// A source guard backs it: no admin route loads a whole users row.
// Mock values only; the network is off.
// Run with:  npx tsx scripts/tests/admin-routes-no-secrets.test.ts
import {
  ADMIN_ID,
  secretColumns,
  secretSentinel,
  sentinelRow,
  setSecretProps,
  TARGET_ID,
  type RouteCall,
} from "./lib/admin-route-harness";

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { getTableColumns, type Column } from "drizzle-orm";

import { agentConfigs, users } from "../../lib/db/schema";

const ROOT = new URL("../../", import.meta.url).pathname;
// The restore route copies this env token into users: a leak would show it.
process.env.GOOGLE_REFRESH_TOKEN = secretSentinel("googleRefreshToken");

type Columns = Record<string, Column>;
const SECRETS = secretColumns([
  getTableColumns(users) as unknown as Columns,
  getTableColumns(agentConfigs) as unknown as Columns,
]);
setSecretProps(SECRETS);

// ── The secret list is real, and every secret column carries a sentinel ──
assert.ok(SECRETS.length > 0, "the secret list is not empty");
for (const name of ["passwordHash", "hypToken", "hypTokenExp"])
  assert.ok(SECRETS.includes(name), `${name} is a secret column`);
const filled = JSON.stringify({
  ...sentinelRow(users),
  ...sentinelRow(agentConfigs),
});
for (const name of SECRETS)
  assert.ok(
    filled.includes(secretSentinel(name)),
    `${name} is filled with a sentinel`,
  );

// ── The walk ────────────────────────────────────────────────────────────
const ADMIN_API = join(ROOT, "app/api/admin");
const ROUTES = readdirSync(ADMIN_API, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && e.name === "route.ts")
  .map((e) => relative(ROOT, join(e.parentPath ?? e.path, e.name)))
  .sort();
/** Not driven, with the reason (still under the source guard below). */
const NOT_DRIVEN: Record<string, string> = {
  // NextAuth's own handler (re-export of auth-handlers.ts): sign-in flow, no admin data.
  "app/api/admin/auth/[...nextauth]/route.ts": "NextAuth handler",
};
assert.ok(
  ROUTES.length >= 15,
  `the walk finds the admin routes (${ROUTES.length})`,
);
assert.ok(ROUTES.includes("app/api/admin/configs/[userId]/route.ts"));

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const HEADERS = {
  "content-type": "application/json",
  "x-internal-secret": process.env.INTERNAL_SECRET ?? "",
};
const QUERY = `?email=admin%40example.com&userId=${TARGET_ID}&limit=5`;
/** A body with the fields the admin routes read, all mock. */
const BODY = {
  email: "admin@example.com",
  userId: TARGET_ID,
  plan: "global",
  subscriptionPlan: "global",
  subscriptionStatus: "active",
  status: "active",
  role: "user",
  phoneNumber: "+15550100999",
  label: "mock",
  ownerWhatsapp: "+15550100999",
  whatsapp: "+15550100999",
  refreshToken: "mock-refresh-token-not-a-secret-sentinel",
  instructions: "mock instructions",
  agentName: "Mock",
  displayName: "Mock",
  freeUnlimited: true,
};

async function callAll(): Promise<RouteCall[]> {
  const { NextRequest } = await import("next/server");
  const calls: RouteCall[] = [];
  for (const file of ROUTES) {
    if (NOT_DRIVEN[file]) continue;
    const mod = (await import(join(ROOT, file))) as Record<string, unknown>;
    const exported = METHODS.filter((m) => typeof mod[m] === "function");
    assert.ok(exported.length > 0, `${file} exports a handler`);
    for (const method of exported) {
      const url = `http://localhost/${file.replace(/^app\//, "").replace(/\/route\.ts$/, "")}${QUERY}`;
      const req = new NextRequest(url, {
        method,
        headers: HEADERS,
        body: method === "GET" ? undefined : JSON.stringify(BODY),
      });
      const ctx = { params: Promise.resolve({ userId: TARGET_ID }) };
      const call: RouteCall = { file, method, status: null, text: "" };
      try {
        const res = (await (
          mod[method] as (r: unknown, c: unknown) => Promise<Response>
        )(req, ctx)) as Response;
        call.status = res.status;
        call.text = await res.text();
      } catch (e) {
        // A throw becomes a bodiless 500 in Next: nothing reaches the browser.
        call.error = e instanceof Error ? e.message : String(e);
      }
      calls.push(call);
    }
  }
  return calls;
}

function assertNoSecret(c: RouteCall) {
  const where = `${c.method} ${c.file} (${c.status ?? "threw"})`;
  for (const name of SECRETS) {
    assert.ok(
      !c.text.includes(`"${name}"`),
      `${where}: no "${name}" key in the response`,
    );
    assert.ok(
      !c.text.includes(secretSentinel(name)),
      `${where}: no ${name} value in the response`,
    );
  }
  assert.ok(
    !c.text.includes("SENTINEL-SECRET-"),
    `${where}: no secret sentinel at all`,
  );
}

// ── Source guard: no admin route loads a whole users row ───────────────
function sourceGuard() {
  for (const file of ROUTES) {
    const s = readFileSync(join(ROOT, file), "utf8").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(
      s,
      /\.select\(\s*\)\s*\.from\(\s*users\s*\)/,
      `${file}: a users read names its fields`,
    );
    assert.doesNotMatch(
      s,
      /\.update\(\s*users\s*\)[\s\S]{0,400}?\.returning\(\s*\)/,
      `${file}: a users update returns named fields`,
    );
  }
}

callAll().then(
  (calls) => {
    const lines = calls.map(
      (c) =>
        `  ${c.method.padEnd(6)} ${c.file} → ${c.status ?? `threw (${c.error})`}`,
    );
    console.log(lines.join("\n"));
    for (const c of calls) assertNoSecret(c);
    // The routes that read users / agent_configs did run (not only threw).
    const ran = (file: string, method: string) =>
      calls.find((c) => c.file === file && c.method === method);
    for (const [file, method] of [
      ["app/api/admin/configs/[userId]/route.ts", "GET"],
      ["app/api/admin/configs/[userId]/route.ts", "PUT"],
      ["app/api/admin/internal-tenants-status/route.ts", "GET"],
      ["app/api/admin/internal-restore-admin-google/route.ts", "GET"],
      ["app/api/admin/internal-restore-admin-google/route.ts", "POST"],
      ["app/api/admin/internal-set-subscription/route.ts", "POST"],
      ["app/api/admin/users/[userId]/route.ts", "PATCH"],
    ] as const) {
      const c = ran(file, method);
      assert.ok(
        c && c.status === 200,
        `${method} ${file} answered 200 (got ${c?.status ?? c?.error})`,
      );
    }
    const cfg = JSON.parse(
      ran("app/api/admin/configs/[userId]/route.ts", "GET")!.text,
    ) as { user: { id: string; door: string } };
    assert.equal(cfg.user.id, ADMIN_ID, "configs GET still serves the user");
    assert.equal(
      cfg.user.door,
      "reception",
      "configs GET keeps the resolved door",
    );
    sourceGuard();
    console.log(
      `ALL ADMIN-ROUTES-NO-SECRETS TESTS PASSED (${calls.length} handler calls, ${ROUTES.length} routes)`,
    );
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
