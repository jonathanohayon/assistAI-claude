// The tamaravox number check (lib/connectors/tamaravox-numbers.ts):
//   1. 200 → vox, 404 → not_vox, 401 / 500 / 302 / a network error / a
//      timeout → unavailable; the request (path, phone query, header);
//   2. TAMARAVOX_URL or TAMARAVOX_EXISTS_SECRET unset → not_configured, no
//      fetch, one alert call (vox_check_not_configured, 24 h dedup), a
//      throwing alert sink never fails the check;
//   3. the body is never read (json() / text() never called, the body is
//      cancelled; a throwing body changes nothing);
//   4. logs carry the outcome and the status only (no secret, no phone, no query);
//   5. source guards: the call path never imports the module; only the create
//      route calls it, before its transaction; the module never reads a body.
// Mock data only (+1555, example.com), no network, no DB.
// Run with:  npx tsx scripts/tests/tamaravox-numbers.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  isTamaravoxNumber,
  VOX_EXISTS_HEADER,
  VOX_NOT_CONFIGURED_ALERT_KEY,
  voxCheckDeps,
  type VoxCheck,
  type VoxCheckDeps,
} from "../../lib/connectors/tamaravox-numbers";

const ROOT = new URL("../../", import.meta.url).pathname;
const PHONE = "+15550001234";
const SECRET = "mock-exists-secret-0123456789";
const BASE = "https://vox.example.com";

type Seen = { url: string; headers: Record<string, string>; signal: AbortSignal | null | undefined };

/** A Response stand-in whose body readers throw and count. */
function fakeResponse(status: number, opts: { cancelThrows?: boolean } = {}) {
  const reads = { json: 0, text: 0, arrayBuffer: 0, blob: 0, cancel: 0 };
  const boom = (k: keyof typeof reads) => () => {
    reads[k]++;
    throw new Error("test: the body must never be read");
  };
  const res = {
    status,
    ok: status >= 200 && status < 300,
    json: boom("json"),
    text: boom("text"),
    arrayBuffer: boom("arrayBuffer"),
    blob: boom("blob"),
    body: {
      cancel: () => {
        reads.cancel++;
        if (opts.cancelThrows) throw new Error("test: cancel failed");
        return Promise.resolve();
      },
      getReader: () => {
        throw new Error("test: the body must never be read");
      },
    },
  } as unknown as Response;
  return { res, reads };
}

function harness(over: Partial<VoxCheckDeps> & { status?: number } = {}) {
  const seen: Seen[] = [];
  const alerts: Array<{ key: string; dedupMs: number }> = [];
  const logs: Array<[VoxCheck, number | null]> = [];
  const made = fakeResponse(over.status ?? 404);
  const deps: VoxCheckDeps = {
    fetch: async (url, init) => {
      seen.push({ url, headers: { ...(init.headers as Record<string, string>) }, signal: init.signal });
      return made.res;
    },
    env: () => ({ url: BASE, secret: SECRET }),
    alert: async (a) => {
      alerts.push({ key: a.key, dedupMs: a.dedupMs });
      return true;
    },
    log: (o, s) => {
      logs.push([o, s]);
    },
    timeoutMs: 1500,
    ...over,
  };
  return { deps, seen, alerts, logs, reads: made.reads };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function walk(dir: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(n)) out.push(p);
  }
  return out;
}

async function main() {
  // ── 1. Status codes and the request ───────────────────────────────────
  for (const [status, want] of [
    [200, "vox"],
    [404, "not_vox"],
    [401, "unavailable"],
    [500, "unavailable"],
    [503, "unavailable"],
    [302, "unavailable"],
    [204, "unavailable"],
  ] as const) {
    const h = harness({ status });
    assert.equal(await isTamaravoxNumber(PHONE, h.deps), want, `${status} → ${want}`);
    assert.deepEqual(h.logs, [[want, status]], `${status}: one log, outcome + status`);
    assert.equal(h.alerts.length, 0, `${status}: no alert`);
  }
  const req = harness({ status: 404 });
  await isTamaravoxNumber(PHONE, req.deps);
  assert.equal(req.seen.length, 1);
  const u = new URL(req.seen[0].url);
  assert.deepEqual([u.origin, u.pathname, u.searchParams.get("phone")], [BASE, "/api/v1/numbers/exists", PHONE], "GET /api/v1/numbers/exists?phone=<E.164>");
  assert.ok(u.search.includes("%2B"), "the + is encoded in the query");
  assert.deepEqual(req.seen[0].headers, { [VOX_EXISTS_HEADER]: SECRET }, "the secret in x-tamaravox-exists-secret, nothing else");
  assert.ok(req.seen[0].signal instanceof AbortSignal, "an abort signal is passed");
  const prefixed = harness({ env: () => ({ url: "https://vox.example.com/base/", secret: SECRET }) });
  await isTamaravoxNumber(PHONE, prefixed.deps);
  assert.equal(new URL(prefixed.seen[0].url).pathname, "/base/api/v1/numbers/exists", "a path prefix in TAMARAVOX_URL is kept");

  const netErr = harness({
    fetch: async () => {
      throw new TypeError("test: fetch failed (mock network down)");
    },
  });
  assert.equal(await isTamaravoxNumber(PHONE, netErr.deps), "unavailable", "a network error → unavailable");
  assert.deepEqual(netErr.logs, [["unavailable", null]]);
  const syncThrow = harness({
    fetch: () => {
      throw new Error("test: sync throw");
    },
  });
  assert.equal(await isTamaravoxNumber(PHONE, syncThrow.deps), "unavailable", "a sync throw → unavailable");
  const badUrl = harness({ env: () => ({ url: "not a url", secret: SECRET }) });
  assert.equal(await isTamaravoxNumber(PHONE, badUrl.deps), "unavailable", "an invalid TAMARAVOX_URL → unavailable");
  assert.equal(badUrl.seen.length, 0);

  // Timeout: a fetch that never resolves and ignores the abort.
  let aborted = false;
  const hang = harness({
    timeoutMs: 40,
    fetch: (_url, init) => {
      init.signal?.addEventListener("abort", () => (aborted = true));
      return new Promise<Response>(() => undefined);
    },
  });
  const t0 = Date.now();
  assert.equal(await isTamaravoxNumber(PHONE, hang.deps), "unavailable", "a timeout → unavailable");
  const took = Date.now() - t0;
  assert.ok(took >= 35 && took < 1000, `the timeout fires (${took} ms)`);
  assert.ok(aborted, "the request is aborted at the timeout");
  assert.deepEqual(hang.logs, [["unavailable", null]]);
  // Timeout: a fetch that honours the abort (rejects with an AbortError).
  const honours = harness({
    timeoutMs: 20,
    fetch: (_url, init) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
  });
  assert.equal(await isTamaravoxNumber(PHONE, honours.deps), "unavailable", "an aborted fetch → unavailable");
  assert.equal(voxCheckDeps.timeoutMs, 1500, "the production timeout is 1500 ms");

  // ── 2. Not configured → skipped + the alert ───────────────────────────
  for (const env of [
    { url: undefined, secret: undefined },
    { url: BASE, secret: undefined },
    { url: undefined, secret: SECRET },
  ]) {
    const h = harness({ env: () => env });
    assert.equal(await isTamaravoxNumber(PHONE, h.deps), "not_configured", `unset (${JSON.stringify(Object.keys(env).filter((k) => !env[k as keyof typeof env]))}) → not_configured`);
    await tick();
    assert.equal(h.seen.length, 0, "not configured: no fetch");
    assert.deepEqual(h.alerts, [{ key: VOX_NOT_CONFIGURED_ALERT_KEY, dedupMs: 24 * 60 * 60 * 1000 }], "one alert call, deduped 24 h by the ledger");
    assert.deepEqual(h.logs, [["not_configured", null]]);
  }
  const throwingAlert = harness({
    env: () => ({ url: undefined, secret: undefined }),
    alert: () => {
      throw new Error("test: alert sink down (sync)");
    },
  });
  assert.equal(await isTamaravoxNumber(PHONE, throwingAlert.deps), "not_configured", "a sync-throwing alert sink never fails the check");
  const rejectingAlert = harness({ env: () => ({ url: undefined, secret: undefined }), alert: async () => Promise.reject(new Error("test: down")) });
  assert.equal(await isTamaravoxNumber(PHONE, rejectingAlert.deps), "not_configured", "a rejecting alert sink never fails the check");
  const throwingEnv = harness({
    env: () => {
      throw new Error("test: env read failed");
    },
  });
  assert.equal(await isTamaravoxNumber(PHONE, throwingEnv.deps), "not_configured", "an env read that throws = not configured");
  // The production env reader: blank values are unset.
  const saved = { url: process.env.TAMARAVOX_URL, secret: process.env.TAMARAVOX_EXISTS_SECRET, worker: process.env.TAMARAVOX_LOOKUP_SECRET };
  process.env.TAMARAVOX_URL = "  ";
  process.env.TAMARAVOX_EXISTS_SECRET = SECRET;
  assert.deepEqual(voxCheckDeps.env(), { url: undefined, secret: SECRET }, "a blank TAMARAVOX_URL is unset");
  process.env.TAMARAVOX_URL = BASE;
  delete process.env.TAMARAVOX_EXISTS_SECRET;
  process.env.TAMARAVOX_LOOKUP_SECRET = "mock-other-secret";
  assert.deepEqual(voxCheckDeps.env(), { url: BASE, secret: undefined }, "only TAMARAVOX_EXISTS_SECRET is read (no other secret name)");
  for (const [k, v] of [["TAMARAVOX_URL", saved.url], ["TAMARAVOX_EXISTS_SECRET", saved.secret], ["TAMARAVOX_LOOKUP_SECRET", saved.worker]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  // ── 3. The body is never read ─────────────────────────────────────────
  for (const status of [200, 404, 500]) {
    const h = harness({ status });
    await isTamaravoxNumber(PHONE, h.deps);
    await tick();
    assert.deepEqual([h.reads.json, h.reads.text, h.reads.arrayBuffer, h.reads.blob], [0, 0, 0, 0], `${status}: no json() / text() / arrayBuffer() / blob()`);
    assert.equal(h.reads.cancel, 1, `${status}: the body is cancelled`);
  }
  const cancelThrows = fakeResponse(200, { cancelThrows: true });
  const ct = harness({ fetch: async () => cancelThrows.res });
  assert.equal(await isTamaravoxNumber(PHONE, ct.deps), "vox", "a cancel that throws changes nothing");
  const cancelRejects = { status: 200, body: { cancel: () => Promise.reject(new Error("test: cancel rejected")) } } as unknown as Response;
  assert.equal(await isTamaravoxNumber(PHONE, harness({ fetch: async () => cancelRejects }).deps), "vox", "a cancel that rejects changes nothing");
  const noBody = { status: 404, body: null } as unknown as Response;
  assert.equal(await isTamaravoxNumber(PHONE, harness({ fetch: async () => noBody }).deps), "not_vox", "no body is fine");
  // A REAL Response whose body stream errors on read: never read, so never thrown.
  const erroring = new Response(
    new ReadableStream({
      pull() {
        throw new Error("test: the body must never be read");
      },
    }),
    { status: 200 },
  );
  assert.equal(await isTamaravoxNumber(PHONE, harness({ fetch: async () => erroring }).deps), "vox", "a real Response with an erroring body → vox");

  // ── 4. Logs: the outcome and the status only ──────────────────────────
  const printed: string[] = [];
  const warn = console.warn;
  const log = console.log;
  const error = console.error;
  console.warn = (...a: unknown[]) => void printed.push(a.map(String).join(" "));
  console.log = console.warn;
  console.error = console.warn;
  try {
    for (const status of [200, 404, 401, 500]) {
      await isTamaravoxNumber(PHONE, { ...voxCheckDeps, env: () => ({ url: BASE, secret: SECRET }), fetch: async () => fakeResponse(status).res });
    }
    await isTamaravoxNumber(PHONE, { ...voxCheckDeps, env: () => ({ url: BASE, secret: SECRET }), fetch: async () => Promise.reject(new Error(`test: ${BASE}?phone=${PHONE}`)) });
    await isTamaravoxNumber(PHONE, { ...voxCheckDeps, env: () => ({ url: undefined, secret: SECRET }), alert: async () => true });
    await tick();
  } finally {
    console.warn = warn;
    console.log = log;
    console.error = error;
  }
  assert.ok(printed.length >= 3, "the default logger prints the failures");
  for (const line of printed) {
    assert.ok(!line.includes(SECRET), "no secret in a log");
    assert.ok(!line.includes("5550001234") && !line.includes("phone=") && !line.includes("vox.example.com"), "no phone, query or URL in a log");
    const parsed = JSON.parse(line) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed).sort(), ["event", "outcome", "status"], "only event / outcome / status");
  }
  assert.ok(printed.some((l) => l === JSON.stringify({ event: "vox_check", outcome: "unavailable", status: 401 })));
  assert.ok(printed.some((l) => l === JSON.stringify({ event: "vox_check", outcome: "not_configured", status: null })));

  // ── 5. Source guards ──────────────────────────────────────────────────
  const callPath = ["lib/agent", "app/api/agent", "app/api/calls"].flatMap((d) => walk(join(ROOT, d)));
  assert.ok(callPath.length > 10, "the call-path folders were scanned");
  for (const f of callPath) {
    assert.ok(!/tamaravox-numbers/.test(readFileSync(f, "utf8")), `the call path never imports tamaravox-numbers (${f.slice(ROOT.length)})`);
  }
  const importers = [...walk(join(ROOT, "lib")), ...walk(join(ROOT, "app"))].filter((f) => /connectors\/tamaravox-numbers/.test(readFileSync(f, "utf8")));
  assert.deepEqual(importers.map((f) => f.slice(ROOT.length)), ["lib/connectors/write.ts"], "only the connector writes import it");
  const write = readFileSync(join(ROOT, "lib/connectors/write.ts"), "utf8");
  const create = write.slice(write.indexOf("export async function createConnector"), write.indexOf("export async function patchConnector"));
  const patchFn = write.slice(write.indexOf("export async function patchConnector"));
  assert.ok(create.indexOf("voxPrecheck(") > 0 && create.indexOf("voxPrecheck(") < create.indexOf("db.transaction("), "create: the check runs BEFORE the transaction");
  assert.ok(!/voxPrecheck|isTamaravoxNumber/.test(patchFn), "PATCH / test never call the check");
  const mod = readFileSync(join(ROOT, "lib/connectors/tamaravox-numbers.ts"), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/\.(json|text|arrayBuffer|blob|formData|getReader)\(/.test(mod), "the module never reads a body");
  assert.ok(!/TAMARAVOX_LOOKUP_SECRET|WORKER_SECRET|x-worker-secret/i.test(mod), "its own secret name and header, never the worker's");

  console.log("ALL TAMARAVOX NUMBER CHECK TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
