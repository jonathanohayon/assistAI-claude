// GET /api/auth/callback is a local-dev helper (Google code -> refresh_token
// shown on a page). In production it must 404 and never touch Google.
// Mock data only: no real code, client or token. Never calls Google.
// Run with:  npx tsx scripts/tests/oauth-callback-dev-only.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";

import { handleDevOAuthCallback } from "../../lib/dev-oauth-callback";

const ROOT = new URL("../../", import.meta.url).pathname;
const BASE = "https://example.test/api/auth/callback";
const MOCK_CODE = "mock-auth-code";
const MOCK_REFRESH = "mock-refresh-token-0000";

function spyClient(refresh: string | null = MOCK_REFRESH) {
  const calls = { load: 0, getToken: [] as string[] };
  const loadOAuthClient = async () => {
    calls.load++;
    return {
      getToken: async (code: string) => {
        calls.getToken.push(code);
        return { tokens: { refresh_token: refresh } };
      },
    };
  };
  return { calls, loadOAuthClient };
}

const checkDevOnly = (modulePath?: string, env: NodeJS.ProcessEnv = process.env) =>
  spawnSync(process.execPath, [join(ROOT, "scripts/check-dev-only.mjs"), ...(modulePath ? [modulePath] : [])], {
    cwd: ROOT,
    env,
    encoding: "utf8",
  });

async function main() {
  // 1. Disabled (production): 404 with or without ?code=, client never loaded, getToken never called.
  for (const url of [BASE, `${BASE}?code=${MOCK_CODE}`]) {
    const spy = spyClient();
    const res = await handleDevOAuthCallback(new NextRequest(url), { enabled: false, loadOAuthClient: spy.loadOAuthClient });
    assert.equal(res.status, 404, `disabled ${url} -> 404`);
    assert.deepEqual(await res.json(), { error: "not_found" }, "plain 404 body, no hint");
    assert.equal(spy.calls.load, 0, "no OAuth client built when disabled");
    assert.deepEqual(spy.calls.getToken, [], "getToken never called when disabled");
  }

  // 2. The real route under NODE_ENV=production: 404 both ways. No DB, no Google env:
  //    if the route reached lib/google or Google it would not answer a clean 404.
  for (const k of ["DATABASE_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]) delete process.env[k];
  (process.env as Record<string, string>).NODE_ENV = "production";
  const { DEV_OAUTH_HELPER_ENABLED } = await import("../../lib/dev-only.mjs");
  assert.equal(DEV_OAUTH_HELPER_ENABLED, false, "flag is off under NODE_ENV=production");
  const { GET } = await import("../../app/api/auth/callback/route");
  for (const url of [BASE, `${BASE}?code=${MOCK_CODE}`]) {
    const res = await GET(new NextRequest(url));
    assert.equal(res.status, 404, `production route ${url} -> 404`);
    assert.deepEqual(await res.json(), { error: "not_found" });
  }

  // 3. Enabled (local dev): the old behaviour, with a mocked client.
  {
    const spy = spyClient();
    const res = await handleDevOAuthCallback(new NextRequest(BASE), { enabled: true, loadOAuthClient: spy.loadOAuthClient });
    assert.equal(res.status, 400, "dev without code -> 400");
    assert.equal(spy.calls.load, 0, "no client built without a code");
  }
  {
    const spy = spyClient();
    const res = await handleDevOAuthCallback(new NextRequest(`${BASE}?code=${MOCK_CODE}`), {
      enabled: true,
      loadOAuthClient: spy.loadOAuthClient,
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.deepEqual(spy.calls.getToken, [MOCK_CODE], "exchanges the given code once");
    const html = await res.text();
    assert.ok(html.includes("GOOGLE_REFRESH_TOKEN=") && html.includes(MOCK_REFRESH), "shows the mocked refresh_token");
  }
  {
    const spy = spyClient(null);
    const res = await handleDevOAuthCallback(new NextRequest(`${BASE}?code=${MOCK_CODE}`), {
      enabled: true,
      loadOAuthClient: spy.loadOAuthClient,
    });
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes("prompt=consent"), "no refresh_token -> consent hint");
  }
  {
    const res = await handleDevOAuthCallback(new NextRequest(`${BASE}?code=${MOCK_CODE}`), {
      enabled: true,
      loadOAuthClient: async () => ({ getToken: async () => { throw new Error("invalid_grant"); } }),
    });
    assert.equal(res.status, 500, "exchange failure -> 500");
  }

  // 4. Build-time guard: passes on the real module, fails when a flag is wrongly true in production.
  const devEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development" as const };
  const ok = checkDevOnly(undefined, devEnv);
  assert.equal(ok.status, 0, `guard passes on lib/dev-only.mjs: ${ok.stderr}`);
  const bad = checkDevOnly(join(ROOT, "scripts/tests/fixtures/dev-only-wrong.mjs"), devEnv);
  assert.equal(bad.status, 1, "guard fails when a dev-only flag is true in production");
  assert.match(bad.stderr, /DEV_OAUTH_HELPER_ENABLED is true/);

  // 5. The guard runs before `next build`.
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.match(pkg.scripts.build, /^node scripts\/check-dev-only\.mjs && next build$/);

  console.log("ALL OAUTH-CALLBACK-DEV-ONLY TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
