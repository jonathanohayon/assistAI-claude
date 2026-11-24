// Number → connector routing (B2): the pure decision, the row → serving
// mapping, the fail-open wrapper (injected reads) and the never-read pins.
// Run with:  npx tsx scripts/tests/connector-route.test.ts
// Mock data only. No database: the wrapper's reads are injected.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getTableColumns } from "drizzle-orm";

import { connectors } from "../../lib/db/schema";
import { CONNECTOR_ROUTE_COLUMNS, connectorServing, routeForCall, servedConnectorVoice, type ConnectorRouteRow } from "../../lib/connectors/route";
import { connectorRouteFailedAlertKey, resolveCallRouteSafely, type ConnectorRouteDeps } from "../../lib/connectors/route-load";
import { DEFAULT_VOICE } from "../../lib/voice/contract";
import { receptionistCapabilities } from "../../lib/tools/store";
import { CLIENT_AGENT_OFF } from "../../lib/tools/contract";

const PA = "00000000-0000-4000-8000-0000000000a1"; // number A (not a connector's)
const PB = "00000000-0000-4000-8000-0000000000b1"; // number B (the connector's)
const K = "00000000-0000-4000-8000-0000000000c1"; // the connector

// ── 1. routeForCall: the table ──────────────────────────────────────────
type Row = { id: string; enabled: boolean; phoneNumberId: string | null };
const on: Row = { id: K, enabled: true, phoneNumberId: PB };
const off: Row = { ...on, enabled: false };
const noNumber: Row = { ...on, phoneNumberId: null };
const ACC_ON = { enabled: true };
const ACC_OFF = { enabled: false };
const TABLE: Array<[string, Row[], string | null, { enabled: boolean } | null, ReturnType<typeof routeForCall>]> = [
  ["zero rows, account agent ON → legacy", [], PB, ACC_ON, { kind: "legacy" }],
  ["zero rows, account agent OFF → legacy", [], PA, ACC_OFF, { kind: "legacy" }],
  ["zero rows, no number (web) → legacy", [], null, ACC_ON, { kind: "legacy" }],
  ["enabled connector on the dialed number → connector", [on], PB, ACC_OFF, { kind: "connector", connectorId: K }],
  ["enabled connector, account agent ON too → connector", [on], PB, ACC_ON, { kind: "connector", connectorId: K }],
  ["connector OFF on its own number → reception", [off], PB, ACC_OFF, { kind: "reception" }],
  ["connector OFF, account agent ON → reception (account agent ignored)", [off], PB, ACC_ON, { kind: "reception", accountAgentIgnored: true }],
  ["another number of the account → reception", [on], PA, ACC_OFF, { kind: "reception" }],
  ["another number, account agent ON → reception (account agent ignored)", [on], PA, ACC_ON, { kind: "reception", accountAgentIgnored: true }],
  ["rows but no number (web / call_me) → reception", [on], null, ACC_ON, { kind: "reception", accountAgentIgnored: true }],
  ["a connector without a number never matches → reception", [noNumber], PB, null, { kind: "reception" }],
  ["unparseable account tools (null) → reception", [on], PA, null, { kind: "reception" }],
];
for (const [name, rows, dialed, acc, want] of TABLE) {
  assert.deepEqual(routeForCall({ connectorRows: rows, dialedPhoneRowId: dialed, accountClientAgent: acc }), want, name);
}
// Two connectors: each number routes to its own.
{
  const K2 = "00000000-0000-4000-8000-0000000000c2";
  const rows = [on, { id: K2, enabled: true, phoneNumberId: PA }];
  assert.deepEqual(routeForCall({ connectorRows: rows, dialedPhoneRowId: PA, accountClientAgent: null }), { kind: "connector", connectorId: K2 });
  assert.deepEqual(routeForCall({ connectorRows: rows, dialedPhoneRowId: PB, accountClientAgent: null }), { kind: "connector", connectorId: K });
}

// ── 2. connectorServing: a row it can't trust throws (no value in the error) ──
const ROW: ConnectorRouteRow = { id: K, url: "https://agent.example.com/hook", mode: "voice", secret: "mock-plain-secret", voiceConfig: null, enabled: true, phoneNumberId: PB };
assert.deepEqual(connectorServing(ROW), {
  clientAgent: { enabled: true, url: "https://agent.example.com/hook", mode: "voice", secret: "mock-plain-secret" },
  voice: null,
});
assert.deepEqual(connectorServing({ ...ROW, voiceConfig: DEFAULT_VOICE }).voice, DEFAULT_VOICE);
assert.equal(connectorServing({ ...ROW, secret: null }).clientAgent.secret, null);
for (const [what, bad] of [
  ["bad mode", { ...ROW, mode: "boss" }],
  ["bad url type", { ...ROW, url: 42 as unknown as string }],
  ["bad secret type", { ...ROW, secret: 7 as unknown as string }],
  ["bad voice_config", { ...ROW, voiceConfig: { voiceId: "mock" } }],
] as const) {
  assert.throws(() => connectorServing(bad), (e: Error) => !e.message.includes("mock") && !e.message.includes("example.com"), what);
}
// The served voice fills the model like servedInboundVoice.
assert.equal(servedConnectorVoice(DEFAULT_VOICE, "gpt-realtime-2").advanced.model, "gpt-realtime-2");
assert.equal(servedConnectorVoice({ ...DEFAULT_VOICE, advanced: { ...DEFAULT_VOICE.advanced, model: "m" } }, "x").advanced.model, "m");

// ── 3. The fail-open wrapper ────────────────────────────────────────────
async function wrapper() {
  const alerts: Array<{ key: string }> = [];
  const alert = async (a: { key: string }) => {
    alerts.push(a);
  };
  const ACC = "00000000-0000-4000-8000-0000000000aa";
  const deps = (over: Partial<ConnectorRouteDeps> = {}): ConnectorRouteDeps => ({
    loadRows: async () => [ROW],
    dialedPhoneRowId: async () => PB,
    ...over,
  });
  const run = (d: ConnectorRouteDeps, extra: { switchOn?: boolean; phone?: string | null } = {}) =>
    resolveCallRouteSafely({
      accountId: ACC,
      phone: extra.phone === undefined ? "+15550000101" : extra.phone,
      switchOn: extra.switchOn ?? true,
      toolsConfig: null,
      deps: d,
      alert,
    });

  // Switch off → legacy with NO read at all.
  let reads = 0;
  const counting = deps({ loadRows: async () => (reads++, [ROW]), dialedPhoneRowId: async () => (reads++, PB) });
  assert.deepEqual(await run(counting, { switchOn: false }), { kind: "legacy" });
  assert.equal(reads, 0, "switch off: no lookup");
  // Zero rows → legacy, the number never looked up.
  reads = 0;
  assert.deepEqual(await run(deps({ loadRows: async () => [], dialedPhoneRowId: async () => (reads++, PB) })), { kind: "legacy" });
  assert.equal(reads, 0, "zero rows: no number lookup");
  // The connector's number → connector, served from the row.
  const c = await run(deps());
  assert.equal(c.kind, "connector");
  assert.deepEqual(c.kind === "connector" && c.serving, connectorServing(ROW));
  // No dialed number → reception, the number never looked up.
  reads = 0;
  assert.deepEqual(await run(deps({ dialedPhoneRowId: async () => (reads++, PB) }), { phone: null }), { kind: "reception" });
  assert.equal(reads, 0);
  assert.equal(alerts.length, 0, "no alert on the normal paths");

  // Each failure point → reception + failed, one alert with the account key; never a throw.
  const failures: Array<[string, ConnectorRouteDeps]> = [
    ["rows read rejects", deps({ loadRows: async () => Promise.reject(new Error("db down")) })],
    ["rows read throws synchronously", deps({ loadRows: (() => { throw new Error("sync"); }) as never })],
    ["number read rejects", deps({ dialedPhoneRowId: async () => Promise.reject(new Error("db down")) })],
    ["bad row (mode)", deps({ loadRows: async () => [{ ...ROW, mode: "boss" }] })],
    ["bad row (voice_config)", deps({ loadRows: async () => [{ ...ROW, voiceConfig: { voiceId: "x" } }] })],
  ];
  for (const [name, d] of failures) {
    alerts.length = 0;
    assert.deepEqual(await run(d), { kind: "reception", failed: true }, name);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(alerts.map((a) => a.key), [connectorRouteFailedAlertKey(ACC)], `${name}: one alert`);
  }
  // An alert sink that throws (sync or async) changes nothing.
  for (const sink of [() => { throw new Error("sync sink"); }, async () => Promise.reject(new Error("async sink"))]) {
    const r = await resolveCallRouteSafely({
      accountId: ACC, phone: "+15550000101", switchOn: true, toolsConfig: null,
      deps: deps({ loadRows: async () => Promise.reject(new Error("db down")) }),
      alert: sink as never,
    });
    assert.deepEqual(r, { kind: "reception", failed: true });
  }
  assert.equal(connectorRouteFailedAlertKey(ACC), `connector_route_failed:${ACC}`);
}

// ── 4. receptionistCapabilities: no override = the account-level setting ──
{
  const toggles = { calendar: true, customers: true, orders: false } as never;
  const plan = { calendar: true, crm: true } as never;
  const toolsConfig = {
    version: 1,
    booking: { enabled: true, defaultDurationMinutes: null, minNoticeMinutes: null },
    contacts: { enabled: true },
    transfer: { enabled: false, when: "always" },
    orders: { enabled: false, ask: "" },
    clientAgent: { enabled: true, url: "https://account.example.com/hook", mode: "lead", secret: "mock-a" },
  };
  const row = { toolsConfig, transferNumber: "", transferNumberParked: "" } as never;
  const base = receptionistCapabilities(row, toggles, true, plan, true);
  assert.deepEqual(receptionistCapabilities(row, toggles, true, plan, true, undefined), base, "undefined override = before");
  const off = receptionistCapabilities(row, toggles, true, plan, true, CLIENT_AGENT_OFF);
  assert.equal(off.capabilities.clientAgent.active, false);
  assert.deepEqual({ ...off.tools, clientAgent: base.tools.clientAgent }, base.tools, "only clientAgent changes");
  assert.deepEqual({ ...off.capabilities, clientAgent: base.capabilities.clientAgent }, base.capabilities, "only the clientAgent capability changes");
  const k = receptionistCapabilities(row, toggles, true, plan, true, connectorServing(ROW).clientAgent);
  assert.equal(k.capabilities.clientAgent.active, true);
  assert.equal(k.tools.clientAgent.url, ROW.url);
  // The site switch still gates a connector.
  assert.equal(receptionistCapabilities(row, toggles, true, plan, false, connectorServing(ROW).clientAgent).capabilities.clientAgent.active, false);
}

// ── 5. Never read, never served: the connectors columns are pinned ───────
{
  const NEVER_READ = ["userId", "name", "lastTestAt", "lastTestOk", "createdAt", "updatedAt"];
  const cols = Object.keys(getTableColumns(connectors));
  for (const c of cols) {
    assert.ok(
      (CONNECTOR_ROUTE_COLUMNS as readonly string[]).includes(c) !== NEVER_READ.includes(c),
      `connectors.${c} must be in exactly one list (CONNECTOR_ROUTE_COLUMNS or NEVER_READ)`,
    );
  }
  // The loader selects exactly CONNECTOR_ROUTE_COLUMNS.
  const src = readFileSync(new URL("../../lib/connectors/route-load.ts", import.meta.url), "utf8");
  const sel = /async function loadRows[\s\S]*?\.select\(\{([\s\S]*?)\}\)/.exec(src)?.[1] ?? "";
  const picked = [...sel.matchAll(/(\w+): connectors\.(\w+)/g)].map((m) => {
    assert.equal(m[1], m[2], "picked under its own name");
    return m[1];
  });
  assert.deepEqual(picked.sort(), [...CONNECTOR_ROUTE_COLUMNS].sort(), "loadRows selects exactly CONNECTOR_ROUTE_COLUMNS");
  // The inbound handler serves no connector field by a new name: it only
  // passes the routed agent to the capabilities and the voice to the engine.
  const inbound = readFileSync(new URL("../../lib/agent/session-config/inbound.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(inbound, /\.\.\.(route|row)\b/, "no connector row spread into the payload");
  assert.doesNotMatch(inbound, /connectorName|lastTest/);
}

wrapper().then(
  () => console.log(`connector-route: ${TABLE.length} routing cases + serving + fail-open + pins OK`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
