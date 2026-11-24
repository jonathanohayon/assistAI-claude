// Connectors B3, pure parts (no DB, no network):
//   1. the signed route token: sign / verify round trip, a tampered payload, a
//      tampered signature, another account, expired, a missing key, junk;
//   2. the key: HKDF of SECRETS_KEY ("connector-route-v1"), null without it;
//   3. the calls/end body parser: clientAgentReached strict, connectorRoute raw;
//   4. attributionFromToken with injected deps: absent / valid / deleted row /
//      invalid / a throwing verifier / a rejecting lookup / a throwing alert;
//   5. source guards: calls/end never re-evaluates the routing rule.
// Mock keys only (fixed bytes). Run with:  npx tsx scripts/tests/connector-call-attribution.test.ts

import assert from "node:assert/strict";
import { createHmac, hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";

import { callInsertValues, parseCallEndBody } from "../../lib/call-end-body";
import {
  attributionFromToken,
  connectorAttributionFailedAlertKey,
  type CallAttributionDeps,
} from "../../lib/connectors/call-attribution";
import {
  CONNECTOR_ROUTE_MAX_AGE_S,
  connectorRouteField,
  connectorRouteKey,
  signConnectorRoute,
  verifyConnectorRoute,
} from "../../lib/connectors/route-token";

const ROOT = new URL("../../", import.meta.url).pathname;
const ACC = "00000000-0000-4000-8000-0000000b3001";
const OTHER = "00000000-0000-4000-8000-0000000b3002";
const K = "00000000-0000-4000-8000-0000000b30c1";
const KEY = Buffer.alloc(32, 7);
const KEY_2 = Buffer.alloc(32, 8);
const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const IAT = Math.floor(NOW / 1000);

async function main() {
  // ── 1. Token ──────────────────────────────────────────────────────────
  const t = signConnectorRoute({ accountId: ACC, connectorId: K, iat: IAT }, KEY);
  const v = (token: unknown, over: { accountId?: string; key?: Buffer | null; nowMs?: number } = {}) =>
    verifyConnectorRoute(token, { accountId: ACC, key: KEY, nowMs: NOW, ...over });
  assert.deepEqual(v(t), { ok: true, connectorId: K }, "round trip");
  assert.equal(t.split(".").length, 2);
  const [body, sig] = t.split(".");
  const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  assert.deepEqual(claims, { v: 1, accountId: ACC, connectorId: K, iat: IAT }, "the payload shape");
  // A tampered payload (another connector id, re-encoded) with the old signature.
  const forged = Buffer.from(JSON.stringify({ ...claims, connectorId: OTHER }), "utf8").toString("base64url");
  assert.deepEqual(v(`${forged}.${sig}`), { ok: false, reason: "signature" }, "tampered payload");
  // A tampered signature (one char flipped, and a truncated one).
  const flipped = sig.slice(0, -2) + (sig.at(-2) === "A" ? "B" : "A") + sig.at(-1);
  assert.deepEqual(v(`${body}.${flipped}`), { ok: false, reason: "signature" }, "tampered signature");
  assert.deepEqual(v(`${body}.${sig.slice(0, 10)}`), { ok: false, reason: "signature" }, "truncated signature");
  assert.deepEqual(v(t, { key: KEY_2 }), { ok: false, reason: "signature" }, "signed with another key");
  // Another account.
  assert.deepEqual(v(t, { accountId: OTHER }), { ok: false, reason: "account" }, "another account");
  // Expired: older than 24 h; a far-future iat is refused too.
  assert.deepEqual(v(t, { nowMs: NOW + CONNECTOR_ROUTE_MAX_AGE_S * 1000 }), { ok: true, connectorId: K }, "exactly 24 h: still valid");
  assert.deepEqual(v(t, { nowMs: NOW + (CONNECTOR_ROUTE_MAX_AGE_S + 1) * 1000 }), { ok: false, reason: "expired" }, "expired");
  assert.deepEqual(v(t, { nowMs: NOW - 60 * 60 * 1000 }), { ok: false, reason: "expired" }, "iat an hour in the future");
  // A missing key.
  assert.deepEqual(v(t, { key: null }), { ok: false, reason: "no_key" }, "missing key");
  // A validly signed token with another version.
  const v2body = Buffer.from(JSON.stringify({ ...claims, v: 2 }), "utf8").toString("base64url");
  const v2 = `${v2body}.${createHmac("sha256", KEY).update(v2body).digest("base64url")}`;
  assert.deepEqual(v(v2), { ok: false, reason: "version" }, "v != 1");
  // Junk never throws.
  for (const junk of [undefined, null, 42, {}, [], "", ".", "a.b.c", "x".repeat(5000), `${body}.`, "%%%.%%%"]) {
    const r = v(junk);
    assert.equal(r.ok, false, `junk ${JSON.stringify(junk)?.slice(0, 20)}`);
  }
  // A validly signed non-JSON body.
  const nb = Buffer.from("not json", "utf8").toString("base64url");
  assert.deepEqual(v(`${nb}.${createHmac("sha256", KEY).update(nb).digest("base64url")}`), { ok: false, reason: "malformed" });
  console.log("ok: 1. token: round trip, tampered payload / signature, another account, expired, no key, junk");

  // ── 2. The key ────────────────────────────────────────────────────────
  const master = Buffer.alloc(32, 3);
  const env = { SECRETS_KEY: master.toString("base64"), SECRETS_KEY_ID: "mock3" };
  const expected = Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "connector-route-v1", 32));
  assert.ok(connectorRouteKey(env)?.equals(expected), "HKDF(SECRETS_KEY, info connector-route-v1)");
  assert.equal(connectorRouteKey({}), null, "no SECRETS_KEY → no key");
  assert.deepEqual(connectorRouteField(ACC, K, {}), {}, "no key → no token served");
  const served = connectorRouteField(ACC, K, env).connectorRoute;
  assert.deepEqual(verifyConnectorRoute(served, { accountId: ACC, key: expected }), { ok: true, connectorId: K });
  console.log("ok: 2. key = HKDF(SECRETS_KEY, connector-route-v1); none without SECRETS_KEY → no token");

  // ── 3. Parser ─────────────────────────────────────────────────────────
  const reached = (x: unknown) => parseCallEndBody(x === "__absent__" ? {} : { clientAgentReached: x }).clientAgentReached;
  assert.equal(reached(true), true);
  assert.equal(reached(false), false);
  assert.equal(reached("__absent__"), null);
  for (const odd of ["yes", "true", 1, 0, null, {}, []]) assert.equal(reached(odd), null, `non-boolean ${JSON.stringify(odd)} → null`);
  assert.equal(parseCallEndBody({}).connectorRoute, undefined, "absent token = undefined");
  assert.equal(parseCallEndBody({ connectorRoute: t }).connectorRoute, t, "token kept as received");
  // An old worker (no B3 field): the inserted values are exactly the pre-B3 keys.
  const oldBody = parseCallEndBody({ fromNumber: "+15550000001", toNumber: "+15550000002", durationSeconds: 5 });
  assert.deepEqual(Object.keys(callInsertValues(oldBody, ACC, null)), [
    "userId", "fromNumber", "toNumber", "transcript", "summary", "durationSeconds", "realtimeProvider", "realtimeModel", "callId", "product",
  ]);
  assert.equal(callInsertValues(parseCallEndBody({ clientAgentReached: false }), ACC, null).clientAgentReached, false);
  assert.ok(!("clientAgentReached" in callInsertValues(parseCallEndBody({ clientAgentReached: "yes" }), ACC, null)));
  console.log("ok: 3. parser: clientAgentReached strict (true / false / else null), additive; token raw");

  // ── 4. attributionFromToken (injected deps) ───────────────────────────
  const alerts: Array<{ key: string; dedupMs: number }> = [];
  let exists = true;
  const deps = (over: Partial<CallAttributionDeps> = {}): CallAttributionDeps => ({
    bypassed: false,
    verify: (token, accountId) => verifyConnectorRoute(token, { accountId, key: KEY, nowMs: NOW }),
    connectorExists: async () => exists,
    alert: async (a) => {
      alerts.push(a);
      return true;
    },
    ...over,
  });
  const settle = () => new Promise((r) => setImmediate(r));
  const run = async (token: unknown, over: Partial<CallAttributionDeps> = {}, account = ACC) => {
    alerts.length = 0;
    const r = await attributionFromToken(token, account, deps(over));
    await settle();
    return r;
  };
  assert.deepEqual(await run(undefined), {}, "absent → today's row");
  assert.equal(alerts.length, 0, "absent → no alert");
  assert.deepEqual(await run(null), {});
  assert.equal(alerts.length, 0);
  assert.deepEqual(await run(t), { product: "connect", connectorId: K }, "valid → connect + id");
  assert.equal(alerts.length, 0);
  exists = false;
  assert.deepEqual(await run(t), { product: "connect", connectorId: null }, "row gone → NULL id, connect kept");
  exists = true;
  assert.deepEqual(await run(t, { bypassed: true }), {}, "bypassed → today's row");
  const oneAlert = (label: string) =>
    assert.deepEqual(alerts.map((a) => [a.key, a.dedupMs]), [[connectorAttributionFailedAlertKey(ACC), 24 * 60 * 60 * 1000]], label);
  for (const [label, token] of [["tampered", `${forged}.${sig}`], ["not a string", 42], ["empty", ""]] as const) {
    assert.deepEqual(await run(token), {}, `${label} → today's row`);
    oneAlert(`${label} → one alert`);
  }
  assert.deepEqual(await run(t, {}, OTHER), {}, "another account → today's row");
  assert.deepEqual(alerts.map((a) => a.key), [connectorAttributionFailedAlertKey(OTHER)]);
  assert.deepEqual(await run(t, { verify: (tok, a) => verifyConnectorRoute(tok, { accountId: a, key: null }) }), {}, "no key");
  oneAlert("no key → one alert");
  const throwing: Array<[string, Partial<CallAttributionDeps>]> = [
    ["verifier throws", { verify: () => { throw new Error("mock verifier down"); } }],
    ["lookup rejects", { connectorExists: async () => Promise.reject(new Error("mock db down")) }],
    ["lookup throws synchronously", { connectorExists: (() => { throw new Error("mock sync"); }) as never }],
  ];
  for (const [label, over] of throwing) {
    assert.deepEqual(await run(t, over), {}, `${label} → today's row`);
    oneAlert(`${label} → one alert`);
  }
  for (const sink of [() => { throw new Error("sync sink"); }, async () => Promise.reject(new Error("async sink"))]) {
    assert.deepEqual(await run(42, { alert: sink as never }), {}, "a throwing alert sink changes nothing");
  }
  assert.equal(connectorAttributionFailedAlertKey(ACC), `connector_attribution_failed:${ACC}`);
  console.log("ok: 4. attribution: absent / valid / row gone / invalid / throw injections (fail-open + one daily alert)");

  // ── 5. Source guards ──────────────────────────────────────────────────
  const route = readFileSync(`${ROOT}app/api/calls/end/route.ts`, "utf8");
  const attribution = readFileSync(`${ROOT}lib/connectors/call-attribution.ts`, "utf8");
  for (const [name, src] of [["calls/end", route], ["call-attribution", attribution]] as const) {
    const code = src.replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/routeForCall|resolveCallRouteSafely/.test(code), `${name} never re-evaluates the routing rule`);
    assert.ok(!/connectors\/route(-load)?["']/.test(code), `${name} imports neither route.ts nor route-load.ts`);
  }
  assert.ok(/from "@\/lib\/connectors\/call-attribution"/.test(route), "calls/end uses the attribution module");
  assert.ok(/attributionFromToken\(parsed\.connectorRoute, user\.id\)/.test(route), "the token comes from the body, the account from the tenant");
  console.log("ok: 5. source guards: calls/end reads the signed token back, never routeForCall / resolveCallRouteSafely");

  console.log("ALL CONNECTOR CALL ATTRIBUTION TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
