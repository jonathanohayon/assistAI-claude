// GET /api/auth/login is the first half of the local-dev OAuth helper (it
// redirects to Google's consent screen, which lands on /api/auth/callback).
// In production it must 404, never load lib/google and never redirect.
// Mock data only: no real client, no real consent URL. Never calls Google.
// Run with:  npx tsx scripts/tests/oauth-login-dev-only.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";

import { DEV_OAUTH_SCOPES, handleDevOAuthLogin } from "../../lib/dev-oauth-callback";

const ROOT = new URL("../../", import.meta.url).pathname;
const MOCK_CONSENT_URL = "https://accounts.example.test/o/oauth2/auth?mock=1";

type AuthUrlOpts = { access_type: string; prompt: string; scope: string[] };

function spyClient() {
  const calls = { load: 0, generateAuthUrl: [] as AuthUrlOpts[] };
  const loadOAuthClient = async () => {
    calls.load++;
    return {
      generateAuthUrl: (opts: AuthUrlOpts) => {
        calls.generateAuthUrl.push(opts);
        return MOCK_CONSENT_URL;
      },
    };
  };
  return { calls, loadOAuthClient };
}

// True once lib/google has been loaded in this process (CJS or ESM path).
const require = createRequire(import.meta.url);
const googleLoaded = () => Object.keys(require.cache).some((k) => /[\\/]lib[\\/]google\.ts$/.test(k));

// Source files the app ships (pages, components, client libs, i18n).
function appSources(): string[] {
  const out: string[] = [];
  for (const dir of ["app", "components", "lib", "i18n", "messages"]) {
    for (const e of readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })) {
      if (e.isFile() && /\.(tsx?|mjs|js|json)$/.test(e.name)) out.push(join(e.parentPath ?? e.path, e.name));
    }
  }
  for (const f of ["proxy.ts", "auth.ts", "auth-handlers.ts", "next.config.ts"]) out.push(join(ROOT, f));
  return out;
}

async function main() {
  // 1. Disabled (production): 404, plain body, no client built, no consent URL, no redirect.
  {
    const spy = spyClient();
    const res = await handleDevOAuthLogin({ enabled: false, loadOAuthClient: spy.loadOAuthClient });
    assert.equal(res.status, 404, "disabled -> 404");
    assert.deepEqual(await res.json(), { error: "not_found" }, "same body as /api/auth/callback");
    assert.equal(res.headers.get("location"), null, "no redirect when disabled");
    assert.equal(spy.calls.load, 0, "getOAuthClient never called when disabled");
    assert.deepEqual(spy.calls.generateAuthUrl, [], "generateAuthUrl never called when disabled");
  }

  // 2. The real route under NODE_ENV=production: 404, no redirect, lib/google never loaded.
  for (const k of ["DATABASE_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]) delete process.env[k];
  (process.env as Record<string, string>).NODE_ENV = "production";
  const { DEV_OAUTH_HELPER_ENABLED } = await import("../../lib/dev-only.mjs");
  assert.equal(DEV_OAUTH_HELPER_ENABLED, false, "flag is off under NODE_ENV=production");
  const { GET } = await import("../../app/api/auth/login/route");
  const res = await GET();
  assert.equal(res.status, 404, "production route -> 404");
  assert.deepEqual(await res.json(), { error: "not_found" });
  assert.equal(res.headers.get("location"), null, "production route sends no redirect");
  assert.equal(googleLoaded(), false, "lib/google not loaded by the production route");
  // The detector itself works: loading lib/google flips it.
  await import("../../lib/google");
  assert.equal(googleLoaded(), true, "googleLoaded() detects lib/google once loaded");

  // 3. Enabled (local dev): unchanged behaviour, redirect to the consent URL of a mocked client.
  {
    const spy = spyClient();
    const res = await handleDevOAuthLogin({ enabled: true, loadOAuthClient: spy.loadOAuthClient });
    assert.ok([302, 307].includes(res.status), `dev -> redirect (got ${res.status})`);
    assert.equal(res.headers.get("location"), MOCK_CONSENT_URL, "redirects to the consent URL");
    assert.equal(spy.calls.load, 1, "builds the client once");
    assert.deepEqual(
      spy.calls.generateAuthUrl,
      [{ access_type: "offline", prompt: "consent", scope: DEV_OAUTH_SCOPES }],
      "same consent options as before",
    );
    assert.deepEqual(DEV_OAUTH_SCOPES, [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/spreadsheets",
    ]);
  }

  // 4. Nothing in the app links to /api/auth/login (so the 404 breaks no UI).
  //    Comments that merely name the route are allowed; links/fetches are not.
  const route = join(ROOT, "app/api/auth/login/route.ts");
  const linkers = appSources()
    .filter((f) => f !== route)
    .filter((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .some((line) => line.includes("/api/auth/login") && !/^\s*(\/\/|\*|\/\*)/.test(line)),
    )
    .map((f) => relative(ROOT, f));
  assert.deepEqual(linkers, [], `no app code links to /api/auth/login: ${linkers.join(", ")}`);

  console.log("ALL OAUTH-LOGIN-DEV-ONLY TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
