import { assertScanRead, scanSources } from "./helpers/source-scan";
// Unit tests for T5a ("Ask your agent" as a Tools capability): the stored
// shape and its write-only secret, the CLIENT_AGENT switch and server gate,
// effectiveCapabilities, the call field (off = absent), the save-time URL
// check and the test endpoint's runner. No DB, no real network (injected
// resolver / fetch).
// Run with:  npx tsx scripts/tests/client-agent-tool.test.ts
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import type { PlanFeatures } from "../../lib/plan-features";
import { SafeUrlError, type Resolver, type SafeResponse } from "../../lib/net/safe-url";
import { clientAgentCallField, receptionistCallFields, toolsFromTileToggles } from "../../lib/tools/adapters";
import { clientAgentEnabled, clientAgentMode } from "../../lib/tools/client-agent-switch";
import {
  CLIENT_AGENT_TEST_BUDGET_MS,
  CLIENT_AGENT_TEST_QUESTION,
  runClientAgentTest,
  type TestFetch,
} from "../../lib/tools/client-agent-test";
import { CLIENT_AGENT_OFF, effectiveCapabilities, publicTools, type Tools } from "../../lib/tools/contract";
import {
  clientAgentRefused,
  clientAgentUrlOk,
  currentReceptionistTools,
  mergeTools,
  outboundToolsRefused,
  parseTools,
  planReceptionistToolsWrite,
  receptionistCapabilities,
} from "../../lib/tools/store";
import { clientAgentUrlRefusal } from "../../lib/tools/write";

const plan: PlanFeatures = { calendar: true, crm: true, whatsapp_confirm: true, whatsapp_recap: true, outbound_campaigns: true };
const toggles = { calendar: true, customers: true, orders: false };
const SAFE = "https://agent.example.com/ask";
const base = toolsFromTileToggles(toggles);
const withAgent = (ca: Partial<Tools["clientAgent"]>): Tools => ({ ...base, clientAgent: { ...CLIENT_AGENT_OFF, ...ca } });
const row = (toolsConfig: unknown) => ({ toolsConfig, transferNumber: "+97220000000", transferNumberParked: null });
const publicResolver: Resolver = async (h) => {
  if (h !== "agent.example.com") throw new Error("ENOTFOUND");
  return [{ address: "93.184.215.14", family: 4 }];
};

async function run(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}`);
    throw e;
  }
}

async function main() {
  // ── The site switch ─────────────────────────────────────────────────
  await run("CLIENT_AGENT: unset/unknown = off, admin, all", () => {
    for (const [v, want] of [[undefined, "off"], ["", "off"], ["on", "off"], ["1", "off"], [" Admin ", "admin"], ["ALL", "all"]] as const)
      assert.equal(clientAgentMode({ CLIENT_AGENT: v }), want, String(v));
    assert.equal(clientAgentEnabled("off", true), false);
    assert.equal(clientAgentEnabled("admin", true), true);
    assert.equal(clientAgentEnabled("admin", false), false);
    assert.equal(clientAgentEnabled("all", false), true);
  });

  // ── Stored shape ────────────────────────────────────────────────────
  await run("a value stored before T5 (no clientAgent) still parses, client agent off", () => {
    const { clientAgent: _c, ...old } = base;
    void _c;
    const p = parseTools(old);
    assert.ok(p.ok);
    if (p.ok) assert.deepEqual(p.value.clientAgent, CLIENT_AGENT_OFF);
  });
  await run("strict validation: unknown keys, bad mode, bad url type, bad secret", () => {
    const bad = (ca: unknown) => parseTools({ ...base, clientAgent: ca });
    assert.deepEqual(bad({ ...CLIENT_AGENT_OFF, extra: 1 }), { ok: false, errors: ["tools.clientAgent.extra: unknown"] });
    assert.equal(bad({ ...CLIENT_AGENT_OFF, mode: "boss" }).ok, false);
    assert.equal(bad({ ...CLIENT_AGENT_OFF, url: 5 }).ok, false);
    assert.equal(bad({ ...CLIENT_AGENT_OFF, url: "x".repeat(2049) }).ok, false);
    assert.equal(bad({ ...CLIENT_AGENT_OFF, secret: "" }).ok, false);
    assert.equal(bad({ ...CLIENT_AGENT_OFF, secret: 5 }).ok, false);
    assert.equal(bad({ enabled: true }).ok, false, "missing fields");
    assert.equal(bad({ ...CLIENT_AGENT_OFF, mode: "voice", secret: "mock-secret" }).ok, true);
  });
  await run("secret is write-only: absent keeps, string sets, null clears; secretSet echo ignored", () => {
    const cur = withAgent({ url: SAFE, secret: "mock-secret" });
    const keep = mergeTools(cur, { clientAgent: { mode: "voice" } });
    assert.ok(keep.ok && keep.value.clientAgent.secret === "mock-secret" && keep.value.clientAgent.mode === "voice");
    const set = mergeTools(cur, { clientAgent: { secret: "mock-other" } });
    assert.ok(set.ok && set.value.clientAgent.secret === "mock-other");
    const clear = mergeTools(cur, { clientAgent: { secret: null } });
    assert.ok(clear.ok && clear.value.clientAgent.secret === null);
    const echo = mergeTools(cur, { clientAgent: { ...publicTools(cur).clientAgent } });
    assert.ok(echo.ok && echo.value.clientAgent.secret === "mock-secret", "re-sent GET body keeps the secret");
    assert.equal(mergeTools(cur, { clientAgent: { secretSet: "yes" } }).ok, false, "a non-boolean secretSet is refused");
  });
  await run("publicTools never carries the secret", () => {
    const p = publicTools(withAgent({ url: SAFE, secret: "mock-secret" }));
    assert.deepEqual(p.clientAgent, { enabled: false, url: SAFE, mode: "lead", secretSet: true });
    assert.ok(!JSON.stringify(p).includes("mock-secret"));
    assert.equal(publicTools(withAgent({})).clientAgent.secretSet, false);
  });
  await run("the receptionist's stored client agent is read back (stored only)", () => {
    const t = currentReceptionistTools(row(withAgent({ enabled: true, url: SAFE, mode: "voice", secret: "s" })), toggles);
    assert.deepEqual(t.clientAgent, { enabled: true, url: SAFE, mode: "voice", secret: "s" });
    assert.deepEqual(currentReceptionistTools(row(null), toggles).clientAgent, CLIENT_AGENT_OFF);
  });

  // ── Capabilities ────────────────────────────────────────────────────
  const caps = (t: Tools, enabled: boolean, recipe: "receptionist" | "outbound" = "receptionist") =>
    effectiveCapabilities({ recipe, tools: t, clientAgentUrlOk: clientAgentUrlOk(t) }, { transferNumber: "", googleConnected: true, clientAgentEnabled: enabled }, plan).clientAgent;
  await run("capability: switch off = client_agent_disabled, never active", () => {
    assert.deepEqual(caps(withAgent({ enabled: true, url: SAFE }), false), {
      requested: true, planIncluded: true, prerequisite: { met: false, missing: "client_agent_disabled" }, active: false,
    });
  });
  await run("capability: on without a usable url = no_agent_url", () => {
    for (const url of ["", "http://agent.example.com/x", "https://10.0.0.1/x", "https://localhost/x", "https://agent.example.com:22/"]) {
      const c = caps(withAgent({ enabled: true, url }), true);
      assert.equal(c.prerequisite.missing, "no_agent_url", url);
      assert.equal(c.active, false, url);
    }
  });
  await run("capability: on + url + switch = active; off switch = inactive", () => {
    assert.equal(caps(withAgent({ enabled: true, url: SAFE }), true).active, true);
    assert.equal(caps(withAgent({ enabled: false, url: SAFE }), true).active, false);
  });
  await run("capability: outbound = not_available_outbound", () => {
    assert.equal(caps(withAgent({ enabled: true, url: SAFE }), true, "outbound").prerequisite.missing, "not_available_outbound");
    assert.equal(caps(withAgent({ enabled: true, url: SAFE }), true, "outbound").active, false);
  });
  await run("the other capabilities don't move whatever the client agent says", () => {
    const a = receptionistCapabilities(row(withAgent({})), toggles, true, plan, false).capabilities;
    const b = receptionistCapabilities(row(withAgent({ enabled: true, url: SAFE, secret: "s" })), toggles, true, plan, true).capabilities;
    const { clientAgent: _a, ...ra } = a;
    const { clientAgent: _b, ...rb } = b;
    void [_a, _b];
    assert.deepEqual(ra, rb);
    assert.deepEqual(receptionistCallFields(a, plan), receptionistCallFields(b, plan));
  });

  // ── Call field ──────────────────────────────────────────────────────
  await run("call field: absent unless active; secret only when set", () => {
    const t = withAgent({ enabled: true, url: SAFE, mode: "voice", secret: "mock-secret" });
    const off = receptionistCapabilities(row(t), toggles, true, plan, false);
    assert.deepEqual(clientAgentCallField(off.capabilities, off.tools), {});
    const on = receptionistCapabilities(row(t), toggles, true, plan, true);
    assert.deepEqual(clientAgentCallField(on.capabilities, on.tools), { clientAgent: { url: SAFE, secret: "mock-secret", mode: "voice" } });
    const noSecret = receptionistCapabilities(row({ ...t, clientAgent: { ...t.clientAgent, secret: null } }), toggles, true, plan, true);
    assert.deepEqual(clientAgentCallField(noSecret.capabilities, noSecret.tools), { clientAgent: { url: SAFE, mode: "voice" } });
  });

  // ── Server gate (3 cases) ───────────────────────────────────────────
  await run("gate (switch off): other fields pass", () => {
    const r = row(withAgent({}));
    const w = planReceptionistToolsWrite(r, toggles, { clientAgent: { url: SAFE, mode: "voice", secret: "s" }, orders: { ask: "x" } });
    assert.ok(w.ok);
    if (w.ok) assert.deepEqual(clientAgentRefused(currentReceptionistTools(r, toggles), w.tools, false), []);
  });
  await run("gate (switch off): an unchanged re-send passes (even an already-on value)", () => {
    const r = row(withAgent({ enabled: true, url: SAFE }));
    const cur = currentReceptionistTools(r, toggles);
    const w = planReceptionistToolsWrite(r, toggles, { clientAgent: publicTools(cur).clientAgent });
    assert.ok(w.ok);
    if (w.ok) assert.deepEqual(clientAgentRefused(cur, w.tools, false), []);
    const off = planReceptionistToolsWrite(r, toggles, { clientAgent: { enabled: false } });
    assert.ok(off.ok);
    if (off.ok) assert.deepEqual(clientAgentRefused(cur, off.tools, false), [], "turning it off passes");
  });
  await run("gate (switch off): turning it on is refused; switch on: allowed", () => {
    const r = row(withAgent({ url: SAFE }));
    const cur = currentReceptionistTools(r, toggles);
    const w = planReceptionistToolsWrite(r, toggles, { clientAgent: { enabled: true } });
    assert.ok(w.ok);
    if (w.ok) {
      assert.deepEqual(clientAgentRefused(cur, w.tools, false), ["tools.clientAgent.enabled"]);
      assert.deepEqual(clientAgentRefused(cur, w.tools, true), []);
    }
  });
  await run("outbound: turning the client agent on is refused (not an outbound capability)", () => {
    assert.deepEqual(outboundToolsRefused(withAgent({}), withAgent({ enabled: true }), true), ["tools.clientAgent.enabled"]);
    assert.deepEqual(outboundToolsRefused(withAgent({ enabled: true }), withAgent({ enabled: true }), false), []);
  });

  // ── Save-time URL check ─────────────────────────────────────────────
  await run("save: an unsafe url is refused with one plain message", async () => {
    const check = { resolver: publicResolver };
    assert.equal(await clientAgentUrlRefusal({ clientAgent: { url: SAFE } }, check), null);
    assert.equal(await clientAgentUrlRefusal({ clientAgent: { url: "" } }, check), null, "clearing passes");
    assert.equal(await clientAgentUrlRefusal({ orders: { ask: "x" } }, check), null, "no url in the patch");
    for (const u of ["http://agent.example.com/x", "https://169.254.169.254/", "https://localhost/x", "https://nope.example.com/x"]) {
      assert.deepEqual(await clientAgentUrlRefusal({ clientAgent: { url: u } }, check), {
        ok: false, status: 400, body: { error: "unsafe_url", message: "This address can't be used", fields: ["tools.clientAgent.url"] },
      }, u);
    }
  });

  // ── Test endpoint runner (injected fetch) ───────────────────────────
  const reply = (status: number, body: string): SafeResponse => ({ status, headers: { "x-internal": "10.0.0.1" }, body: Buffer.from(body) });
  await run("test: ONE contract body, HMAC of the raw body, 2.5 s budget", async () => {
    let seen: { url: string; headers: Record<string, string>; body: string; timeoutMs: number } | null = null;
    const f: TestFetch = async (url, init, opts) => {
      seen = { url, headers: init.headers!, body: init.body!, timeoutMs: opts.timeoutMs };
      return reply(200, '{"answer":"We open at 9."}');
    };
    const r = await runClientAgentTest({ url: SAFE, secret: "mock-secret", language: "he" }, { fetch: f });
    assert.equal(r.ok, true);
    assert.ok(seen);
    const s = seen as unknown as { url: string; headers: Record<string, string>; body: string; timeoutMs: number };
    const parsed = JSON.parse(s.body);
    assert.deepEqual(Object.keys(parsed), ["call_id", "turn_id", "language", "question", "caller_said", "history"]);
    assert.match(parsed.call_id, /^[0-9a-f]{32}$/);
    assert.equal(parsed.turn_id, 0);
    assert.equal(parsed.language, "he");
    assert.equal(parsed.question, CLIENT_AGENT_TEST_QUESTION);
    assert.equal(parsed.caller_said, "");
    assert.deepEqual(parsed.history, []);
    assert.equal(s.headers["X-Tamara-Signature"], createHmac("sha256", "mock-secret").update(s.body).digest("hex"));
    assert.equal(s.timeoutMs, CLIENT_AGENT_TEST_BUDGET_MS);
    assert.equal(CLIENT_AGENT_TEST_BUDGET_MS, 2500);
  });
  await run("test: no secret = no signature header", async () => {
    let headers: Record<string, string> = {};
    await runClientAgentTest({ url: SAFE, secret: null, language: "fr" }, { fetch: async (_u, i) => ((headers = i.headers!), reply(200, '{"answer":"ok"}')) });
    assert.equal("X-Tamara-Signature" in headers, false);
  });
  await run("test: answers only { ok, ms } or { ok, reason } — never the remote body/headers", async () => {
    let t = 1000;
    const now = () => (t += 120);
    const ok = await runClientAgentTest({ url: SAFE, secret: null, language: "fr" }, { fetch: async () => reply(200, '{"answer":"SECRET-BODY"}'), now });
    assert.deepEqual(ok, { ok: true, ms: 120 });
    assert.ok(!JSON.stringify(ok).includes("SECRET-BODY"));
    const bad = await runClientAgentTest({ url: SAFE, secret: null, language: "fr" }, { fetch: async () => reply(500, "SECRET-BODY 10.0.0.1") });
    assert.deepEqual(bad, { ok: false, reason: "http_status" });
  });
  await run("test: `reply` accepted for one release; bad shapes refused", async () => {
    const go = (status: number, body: string) => runClientAgentTest({ url: SAFE, secret: null, language: "fr" }, { fetch: async () => reply(status, body) });
    assert.equal((await go(200, '{"reply":"old contract"}')).ok, true);
    for (const b of ["not json", "{}", '{"answer":""}', '{"answer":5}', "[]", '{"answer":"  "}']) assert.deepEqual(await go(200, b), { ok: false, reason: "bad_shape" }, b);
    assert.deepEqual(await go(404, '{"answer":"x"}'), { ok: false, reason: "http_status" });
  });
  await run("test: guard failures map to stable reasons", async () => {
    const go = (code: string) =>
      runClientAgentTest({ url: SAFE, secret: null, language: "fr" }, { fetch: async () => { throw new SafeUrlError(code as never); } });
    for (const c of ["blocked_address", "blocked_host", "not_https", "port", "userinfo", "invalid_url", "dns_failed"]) assert.deepEqual(await go(c), { ok: false, reason: "blocked_address" }, c);
    assert.deepEqual(await go("timeout"), { ok: false, reason: "timeout" });
    assert.deepEqual(await go("too_large"), { ok: false, reason: "too_large" });
    assert.deepEqual(await go("network"), { ok: false, reason: "network" });
    assert.deepEqual(await go("redirect"), { ok: false, reason: "http_status" });
    const other = await runClientAgentTest({ url: SAFE, secret: null, language: "fr" }, { fetch: async () => { throw new Error("ECONNREFUSED 10.0.0.1"); } });
    assert.deepEqual(other, { ok: false, reason: "network" });
    assert.deepEqual(await runClientAgentTest({ url: "", secret: null, language: "fr" }), { ok: false, reason: "no_agent_url" });
  });
  await run("test: the real guard refuses a blocked url before any request (default fetch)", async () => {
    assert.deepEqual(await runClientAgentTest({ url: "https://169.254.169.254/latest", secret: null, language: "fr" }), { ok: false, reason: "blocked_address" });
    assert.deepEqual(await runClientAgentTest({ url: "http://agent.example.com/", secret: null, language: "fr" }), { ok: false, reason: "blocked_address" });
  });

  console.log("client-agent-tool: all passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// No route serializes a raw agent row with its Tools store (it holds the
// client-agent secret): every dashboard/admin route that returns an
// agent_configs / outbound_agents row passes it through withoutToolsStore.
{
  const routeScan = scanSources(["app/api/dashboard", "app/api/admin/configs"], { ext: /^route\.ts$/ });
  // A scan that found no route would pass this guard trivially.
  assertScanRead(routeScan, "raw Tools store route scan", {
    minFiles: 30,
    sentinels: ["app/api/dashboard/tools/route.ts", "app/api/dashboard/config/route.ts"],
  });
  const routes = routeScan.files;
  for (const f of routes) {
    const src = routeScan.text.get(f)!;
    const selectsWholeRow = /\.select\(\)\s*\.from\((outboundAgents|agentConfigs)\)/.test(src);
    const returnsRow = /NextResponse\.json\(\{[^)]*\b(agent|config|cfg|updated|created)\b/.test(src) || /agents:\s*rows\.map/.test(src);
    if (selectsWholeRow && returnsRow) {
      if (!src.includes("withoutToolsStore")) throw new Error(`${f} returns a raw agent row without withoutToolsStore`);
    }
  }
  console.log(`ok   no dashboard route returns a raw Tools store (${routes.length} routes scanned)`);
}
