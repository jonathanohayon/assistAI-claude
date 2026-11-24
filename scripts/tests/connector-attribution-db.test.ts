// Connectors B3 against a THROWAWAY Postgres: the REAL session-config handler
// (buildInboundConfig) serves the signed route token, the REAL /api/calls/end
// handler reads it back and attributes the call:
//   1. zero connector rows → the calls row (all columns) byte-identical to a
//      run with the attribution BYPASSED, and the same recap side effects;
//   2. a connector on number B → a call ending to B carries connector_id +
//      product 'connect'; a call to A is unchanged (= the bypassed row);
//   3. the connector OFF → no token served → no attribution;
//   4. CLIENT_AGENT off → no token → no attribution;
//   5. clientAgentReached true / false / absent / "yes" → true / false / NULL / NULL;
//   6. tampered / another account / expired / junk tokens and throw
//      injections (verifier, lookup) → the bypassed row + ONE daily alert;
//   7. a deleted connector: past calls keep their row with connector_id NULL
//      (FK SET NULL); a token of a deleted connector → NULL + 'connect';
//   in every case the recap side effects (owner WhatsApp + owner email, both
//   mocked) are those of the bypassed run.
// Nothing leaves the process: fetch answers only the OpenAI summary and the
// Twilio Messages mock; the email sender is injected. Mock data only (+1555,
// example.com). Skipped in a plain `npm test`. Run with:
//   bash scripts/connector-attribution-db.sh

import assert from "node:assert/strict";

const url = process.env.CONNECTOR_ATTRIBUTION_DB_URL;
if (!url) {
  console.log("SKIPPED connector-attribution-db (set CONNECTOR_ATTRIBUTION_DB_URL — see scripts/connector-attribution-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
process.env.DATABASE_URL = url;
// In-process fakes only (the harness runs with env -i). Mock sealing key (32 x 0x05).
Object.assign(process.env, {
  INTERNAL_SECRET: "test-internal-secret",
  WHATSAPP_PROVIDER: "twilio",
  TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000",
  TWILIO_AUTH_TOKEN: "test-not-a-token",
  TWILIO_WHATSAPP_FROM: "+15555550000",
  WHATSAPP_OWNER_TEMPLATE_SID: "HXowner",
  REALTIME_API_KEY: "test-not-a-key",
  CLIENT_AGENT: "all",
  SECRETS_KEY: Buffer.alloc(32, 5).toString("base64"),
  SECRETS_KEY_ID: "mock5",
});
delete process.env.OPENAI_API_KEY;

const sent: string[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (u.startsWith("https://api.openai.com/v1/chat/completions")) {
    const content = JSON.stringify({ summary: "Mock summary", for_client: "Thanks Dana.", for_owner: "Dana called about a mock booking." });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }
  if (/^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/ACtest0+\/Messages\.json$/.test(u) && init?.method === "POST") {
    sent.push(String(init.body));
    return new Response(JSON.stringify({ sid: `SMtest${sent.length}` }), { status: 201 });
  }
  if (/^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/ACtest0+\/Messages\/SMtest\d+\.json$/.test(u)) {
    return new Response(JSON.stringify({ status: "delivered" }), { status: 200 });
  }
  throw new Error(`test: unexpected network call to ${u}`);
}) as typeof fetch;

const ACC = "00000000-0000-4000-8000-0000000b3001";
const OTHER = "00000000-0000-4000-8000-0000000b3002";
const PA = "+15550000301";
const PB = "+15550000302";
const CALLER = "+15550000399";
const OWNER = "+15550000388";
const BOT_HOOK = "https://bot.example.com/hook";

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const endRoute = await import("../../app/api/calls/end/route");
  const { buildInboundConfig, DRY_INBOUND_EFFECTS } = await import("../../lib/agent/session-config/inbound");
  const { callAttributionDeps, connectorAttributionFailedAlertKey } = await import("../../lib/connectors/call-attribution");
  const { signConnectorRoute, connectorRouteKey, verifyConnectorRoute } = await import("../../lib/connectors/route-token");
  const { ownerRecapEmailDeps } = await import("../../lib/owner-recap-email-send");
  const { sealSecret } = await import("../../lib/crypto/secret-box");
  const exec = (q: ReturnType<typeof sql>) => db.execute(q);
  const rows = <T>(r: unknown) => (Array.isArray(r) ? r : (r as { rows: T[] }).rows) as T[];

  // ── Effects: alerts captured, emails counted (never sent) ─────────────
  const alerts: Array<{ key: string; dedupMs: number }> = [];
  callAttributionDeps.alert = async (a) => {
    alerts.push(a);
    return true;
  };
  const LIVE_VERIFY = callAttributionDeps.verify;
  const LIVE_EXISTS = callAttributionDeps.connectorExists;
  const emails: string[] = [];
  ownerRecapEmailDeps.senderConfigured = () => true;
  ownerRecapEmailDeps.recentSent = async () => false;
  ownerRecapEmailDeps.send = (async (to: string) => {
    emails.push(to);
    return { ok: true };
  }) as never;

  // ── Fixture: one account, two numbers, owner recap WhatsApp + email ON ─
  await exec(sql`DELETE FROM users WHERE id IN (${ACC}, ${OTHER})`);
  await exec(sql`INSERT INTO users (id, email, password_hash, display_name, subscription_plan, subscription_status)
    VALUES (${ACC}, 'b3@connector-attribution.example.com', 'x', 'Attribution Mock', 'premium', 'active'),
           (${OTHER}, 'b3-other@connector-attribution.example.com', 'x', 'Other Mock', 'premium', 'active')`);
  await exec(sql`INSERT INTO agent_configs (user_id, instructions, greeting_instructions, agent_name, voice, primary_language, owner_whatsapp, owner_recap_email, owner_recap_email_enabled)
    VALUES (${ACC}, 'Mock instructions.', 'Hello, Mock here.', 'Mock', 'marin', 'en', ${OWNER}, 'owner@connector-attribution.example.com', true)`);
  await exec(sql`INSERT INTO phone_numbers (user_id, phone_number) VALUES (${ACC}, ${PA}), (${ACC}, ${PB})`);
  const [{ id: PB_ID }] = rows<{ id: string }>(await exec(sql`SELECT id FROM phone_numbers WHERE phone_number = ${PB}`));

  const fx = {
    ...DRY_INBOUND_EFFECTS,
    urlCheck: { resolver: async () => [{ address: "93.184.216.34", family: 4 as const }] },
  };
  /** The session-config payload's connectorRoute for a call to `phone` (undefined = none served). */
  const servedToken = async (phone: string): Promise<string | undefined> => {
    const res = await buildInboundConfig(new URLSearchParams({ phone }), fx);
    assert.equal(res.status, 200);
    return ((await res.json()) as { connectorRoute?: string }).connectorRoute;
  };

  const TRANSCRIPT = [
    { role: "assistant", text: "Hello, Mock here." },
    { role: "user", text: "I would like a mock booking." },
  ];
  const settle = async () => {
    // The owner email and the alert are fire-and-forget: let them run.
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 10));
  };
  type Outcome = { status: number; json: Record<string, unknown>; row: Record<string, unknown>; sent: string[]; emails: string[]; alerts: string[] };
  /** One call end, from a clean slate (no dedup across runs). The row: every column but id / created_at. */
  const end = async (over: Record<string, unknown> = {}, opts: { bypassed?: boolean } = {}): Promise<Outcome> => {
    await exec(sql`DELETE FROM events`);
    await exec(sql`DELETE FROM calls WHERE user_id = ${ACC}`);
    sent.length = 0;
    emails.length = 0;
    alerts.length = 0;
    callAttributionDeps.bypassed = opts.bypassed === true;
    const body = { fromNumber: CALLER, toNumber: PB, transcript: TRANSCRIPT, durationSeconds: 75, callId: "mock-room-b3", ...over };
    const req = new NextRequest("http://localhost/api/calls/end", {
      method: "POST",
      headers: { "x-internal-secret": "test-internal-secret", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await endRoute.POST(req);
    const json = (await res.json()) as Record<string, unknown>;
    await settle();
    callAttributionDeps.bypassed = false;
    const [row] = rows<Record<string, unknown>>(await exec(sql`SELECT * FROM calls WHERE id = ${json.callId as string}`));
    assert.ok(row, "the calls row exists");
    delete row.id;
    delete row.created_at;
    delete json.callId;
    return { status: res.status, json, row, sent: [...sent], emails: [...emails], alerts: alerts.map((a) => a.key) };
  };
  /** Same row (all columns), same response, same recap side effects as `base`, except `diff`. */
  const sameAs = (got: Outcome, base: Outcome, label: string, diff: Record<string, unknown> = {}) => {
    assert.equal(got.status, 200, `${label}: status`);
    assert.deepEqual(got.row, { ...base.row, ...diff }, `${label}: calls row`);
    assert.deepEqual(got.json, base.json, `${label}: response`);
    assert.deepEqual(got.sent, base.sent, `${label}: WhatsApp recap`);
    assert.deepEqual(got.emails, base.emails, `${label}: recap email`);
  };

  // ── 1. Zero connector rows ─────────────────────────────────────────────
  assert.equal(rows<{ n: string }>(await exec(sql`SELECT count(*)::text AS n FROM connectors`))[0].n, "0");
  assert.equal(await servedToken(PB), undefined, "zero rows: no token served");
  const baseB = await end({}, { bypassed: true });
  const baseA = await end({ toNumber: PA }, { bypassed: true });
  assert.equal(baseB.sent.length, 1, "the owner WhatsApp recap went out (the comparison is meaningful)");
  assert.deepEqual(baseB.emails, ["owner@connector-attribution.example.com"], "the owner email recap went out");
  assert.equal(baseB.row.connector_id, null);
  assert.equal(baseB.row.product, null);
  assert.equal(baseB.row.client_agent_reached, null);
  sameAs(await end(), baseB, "zero rows on B");
  sameAs(await end({ toNumber: PA }), baseA, "zero rows on A");
  assert.deepEqual(alerts, [], "zero rows: no alert");
  console.log("ok: 1. zero connector rows: the calls row (all columns) + response + recaps = the attribution bypassed");

  // ── 2. A connector on B ────────────────────────────────────────────────
  const [{ id: K }] = rows<{ id: string }>(await exec(sql`INSERT INTO connectors (user_id, name, url, mode, secret, phone_number_id)
    VALUES (${ACC}, 'Mock Bot B3', ${BOT_HOOK}, 'voice', ${sealSecret("mock-connector-secret")}, ${PB_ID}) RETURNING id`));
  const tokB = await servedToken(PB);
  assert.equal(typeof tokB, "string", "session-config serves the token on the connector's number");
  assert.equal(await servedToken(PA), undefined, "no token on number A");
  const onB = await end({ connectorRoute: tokB });
  sameAs(onB, baseB, "connector call on B", { connector_id: K, product: "connect" });
  assert.deepEqual(onB.alerts, []);
  sameAs(await end({ toNumber: PA }), baseA, "call on A (no token) unchanged");
  sameAs(await end(), baseB, "a call on B whose worker echoed nothing: today's row (no re-evaluation)");
  console.log("ok: 2. connector on B: connector_id + product 'connect'; A unchanged; no echo = today's row");

  // ── 3. The connector OFF ───────────────────────────────────────────────
  await exec(sql`UPDATE connectors SET enabled = false WHERE id = ${K}`);
  const tokOff = await servedToken(PB);
  assert.equal(tokOff, undefined, "connector OFF: no token served");
  sameAs(await end({ connectorRoute: tokOff }), baseB, "connector OFF: no attribution");
  // Toggled OFF mid-call: the token served at the start still attributes (recorded, never re-evaluated).
  sameAs(await end({ connectorRoute: tokB }), baseB, "toggled OFF mid-call: attributed", { connector_id: K, product: "connect" });
  await exec(sql`UPDATE connectors SET enabled = true WHERE id = ${K}`);
  console.log("ok: 3. connector OFF → no token → no attribution; a token served before the toggle still attributes");

  // ── 4. CLIENT_AGENT off ────────────────────────────────────────────────
  process.env.CLIENT_AGENT = "";
  const tokSwitchOff = await servedToken(PB);
  process.env.CLIENT_AGENT = "all";
  assert.equal(tokSwitchOff, undefined, "CLIENT_AGENT off: no token served");
  sameAs(await end({ connectorRoute: tokSwitchOff }), baseB, "CLIENT_AGENT off: no attribution");
  console.log("ok: 4. CLIENT_AGENT off → no token → no attribution");

  // ── 5. clientAgentReached ──────────────────────────────────────────────
  for (const [given, stored] of [[true, true], [false, false], ["yes", null], [1, null]] as const) {
    sameAs(await end({ clientAgentReached: given }), baseB, `clientAgentReached ${JSON.stringify(given)}`, { client_agent_reached: stored });
  }
  sameAs(await end({ connectorRoute: tokB, clientAgentReached: true }), baseB, "connector call + reached", {
    connector_id: K,
    product: "connect",
    client_agent_reached: true,
  });
  assert.deepEqual(alerts, [], "a non-boolean clientAgentReached never alerts");
  console.log("ok: 5. clientAgentReached true / false / absent / \"yes\" / 1 → true / false / NULL / NULL / NULL");

  // ── 6. Invalid tokens + throw injections: today's row + one daily alert ─
  const key = connectorRouteKey();
  assert.ok(key);
  const [body, sig] = tokB!.split(".");
  const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  const forgedBody = Buffer.from(JSON.stringify({ ...claims, connectorId: "00000000-0000-4000-8000-00000000dead" })).toString("base64url");
  const bad: Array<[string, unknown]> = [
    ["tampered payload", `${forgedBody}.${sig}`],
    ["tampered signature", `${body}.${sig.slice(0, -4)}AAAA`],
    ["another account's token", signConnectorRoute({ accountId: OTHER, connectorId: K }, key)],
    ["expired", signConnectorRoute({ accountId: ACC, connectorId: K, iat: Math.floor(Date.now() / 1000) - 25 * 60 * 60 }, key)],
    ["not a string", { connectorId: K }],
  ];
  for (const [label, token] of bad) {
    const r = await end({ connectorRoute: token });
    sameAs(r, baseB, label);
    assert.deepEqual(r.alerts, [connectorAttributionFailedAlertKey(ACC)], `${label}: one alert`);
  }
  const injections: Array<[string, () => void]> = [
    ["verifier throws", () => { callAttributionDeps.verify = () => { throw new Error("mock verifier down"); }; }],
    ["lookup rejects", () => { callAttributionDeps.connectorExists = async () => Promise.reject(new Error("mock db down")); }],
    ["lookup throws synchronously", () => { callAttributionDeps.connectorExists = (() => { throw new Error("mock sync"); }) as never; }],
    ["alert sink throws too", () => {
      callAttributionDeps.verify = () => { throw new Error("mock verifier down"); };
      callAttributionDeps.alert = (() => { throw new Error("mock sink"); }) as never;
    }],
  ];
  const captureAlert = callAttributionDeps.alert;
  for (const [label, inject] of injections) {
    inject();
    const r = await end({ connectorRoute: tokB });
    callAttributionDeps.verify = LIVE_VERIFY;
    callAttributionDeps.connectorExists = LIVE_EXISTS;
    const sinkThrew = callAttributionDeps.alert !== captureAlert;
    callAttributionDeps.alert = captureAlert;
    sameAs(r, baseB, label);
    assert.deepEqual(r.alerts, sinkThrew ? [] : [connectorAttributionFailedAlertKey(ACC)], `${label}: alert`);
  }
  assert.equal(connectorAttributionFailedAlertKey(ACC), `connector_attribution_failed:${ACC}`);
  console.log(`ok: 6. ${bad.length} invalid tokens + ${injections.length} throw injections → the bypassed row + recaps, one daily alert`);

  // ── 7. A deleted connector ─────────────────────────────────────────────
  // A connector call recorded, then the connector hard-deleted: the call stays, connector_id NULL (FK SET NULL).
  await exec(sql`DELETE FROM events`);
  await exec(sql`DELETE FROM calls WHERE user_id = ${ACC}`);
  const kept = await endRoute.POST(
    new NextRequest("http://localhost/api/calls/end", {
      method: "POST",
      headers: { "x-internal-secret": "test-internal-secret", "content-type": "application/json" },
      body: JSON.stringify({ fromNumber: CALLER, toNumber: PB, transcript: TRANSCRIPT, durationSeconds: 75, callId: "mock-room-b3-kept", connectorRoute: tokB }),
    }),
  );
  const keptId = ((await kept.json()) as { callId: string }).callId;
  await settle();
  const before = rows<Record<string, unknown>>(await exec(sql`SELECT * FROM calls WHERE id = ${keptId}`))[0];
  assert.equal(before.connector_id, K);
  await exec(sql`DELETE FROM connectors WHERE id = ${K}`);
  const after = rows<Record<string, unknown>>(await exec(sql`SELECT * FROM calls WHERE id = ${keptId}`))[0];
  assert.ok(after, "the call stays");
  assert.deepEqual(after, { ...before, connector_id: null }, "only connector_id changed (FK SET NULL); product 'connect' kept");
  // A token of a connector deleted mid-call: still a connector call, no id.
  assert.deepEqual(verifyConnectorRoute(tokB, { accountId: ACC, key }), { ok: true, connectorId: K });
  const gone = await end({ connectorRoute: tokB });
  sameAs(gone, baseB, "token of a deleted connector", { connector_id: null, product: "connect" });
  assert.deepEqual(gone.alerts, [], "a deleted connector is not a failure");
  console.log("ok: 7. deleted connector: past calls stay (connector_id NULL); a token of a deleted one → NULL + 'connect'");

  await exec(sql`DELETE FROM users WHERE id IN (${ACC}, ${OTHER})`);
  console.log("ALL CONNECTOR ATTRIBUTION DB TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
