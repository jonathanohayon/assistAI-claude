// Account developer-mode store (components/bricks/developer-mode-store.ts).
// Run with:  npx tsx scripts/tests/developer-mode-store.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  __resetDeveloperModeStore,
  getDeveloperMode,
  loadDeveloperMode,
  setDeveloperMode,
  subscribeDeveloperMode,
} from "../../components/bricks/developer-mode-store";

type Call = { url: string; init?: RequestInit };
function mockFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 500 };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function main() {
  // loads once, concurrent callers share one request
  {
    __resetDeveloperModeStore();
    const { f, calls } = mockFetch([{ status: 200, body: { developerMode: true } }]);
    assert.equal(getDeveloperMode().enabled, null);
    await Promise.all([loadDeveloperMode(null, f), loadDeveloperMode(null, f)]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/dashboard/account");
    assert.equal(getDeveloperMode().enabled, true);
    await loadDeveloperMode(null, f);
    assert.equal(calls.length, 1, "already loaded: no refetch");
  }

  // admin acting on a tenant: separate entry, asUserId in the URL
  {
    __resetDeveloperModeStore();
    const { f, calls } = mockFetch([{ status: 200, body: { developerMode: false } }]);
    await loadDeveloperMode("u-mock-1", f);
    assert.equal(calls[0].url, "/api/dashboard/account?asUserId=u-mock-1");
    assert.equal(getDeveloperMode("u-mock-1").enabled, false);
    assert.equal(getDeveloperMode().enabled, null, "own account untouched");
  }

  // load failure → off (safe default), error flagged
  {
    __resetDeveloperModeStore();
    const { f } = mockFetch([{ status: 500 }]);
    await loadDeveloperMode(null, f);
    assert.deepEqual(getDeveloperMode(), { enabled: false, saving: false, error: "load" });
  }

  // optimistic save notifies subscribers, then confirms from the server
  {
    __resetDeveloperModeStore();
    const { f, calls } = mockFetch([
      { status: 200, body: { developerMode: false } },
      { status: 200, body: { developerMode: true } },
    ]);
    await loadDeveloperMode(null, f);
    const seen: Array<boolean | null> = [];
    const off = subscribeDeveloperMode(null, () => seen.push(getDeveloperMode().enabled));
    const ok = await setDeveloperMode(null, true, f);
    off();
    assert.equal(ok, true);
    assert.deepEqual(seen, [true, true]);
    assert.equal(calls[1].init?.method, "PUT");
    assert.equal(calls[1].init?.body, JSON.stringify({ developerMode: true }));
  }

  // save failure rolls back
  {
    __resetDeveloperModeStore();
    const { f } = mockFetch([
      { status: 200, body: { developerMode: false } },
      { status: 400, body: { error: "invalid_developer_mode" } },
    ]);
    await loadDeveloperMode(null, f);
    const ok = await setDeveloperMode(null, true, f);
    assert.equal(ok, false);
    assert.deepEqual(getDeveloperMode(), { enabled: false, saving: false, error: "save" });
  }

  // a failed load is retried on the next call
  {
    __resetDeveloperModeStore();
    const { f, calls } = mockFetch([{ status: 500 }, { status: 200, body: { developerMode: true } }]);
    await loadDeveloperMode(null, f);
    assert.equal(getDeveloperMode().error, "load");
    await loadDeveloperMode(null, f);
    assert.equal(calls.length, 2);
    assert.deepEqual(getDeveloperMode(), { enabled: true, saving: false, error: null });
  }

  // rapid double toggle: the older save's late outcome never overrides the newer one
  {
    __resetDeveloperModeStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let n = 0;
    const f = (async (_url: string, init?: RequestInit) => {
      n++;
      if (!init?.method) return new Response(JSON.stringify({ developerMode: false }), { status: 200 });
      if (n === 2) {
        await gate; // first PUT (→ true) fails, but only after the second
        return new Response("{}", { status: 500 });
      }
      return new Response(JSON.stringify({ developerMode: false }), { status: 200 });
    }) as unknown as typeof fetch;
    await loadDeveloperMode(null, f);
    const first = setDeveloperMode(null, true, f);
    const second = await setDeveloperMode(null, false, f);
    release();
    assert.equal(await first, false);
    assert.equal(second, true);
    assert.deepEqual(getDeveloperMode(), { enabled: false, saving: false, error: null });
  }

  // copy exists in all three languages
  for (const l of ["en", "fr", "he"]) {
    const b = JSON.parse(readFileSync(new URL(`../../messages/${l}.json`, import.meta.url), "utf8")).Bricks;
    for (const k of ["moreSettings", "developerModeLabel", "developerModeHint", "developerModeSaveError"]) {
      assert.ok(b?.[k], `${l}: Bricks.${k}`);
    }
  }

  console.log("ALL DEVELOPER-MODE STORE TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
