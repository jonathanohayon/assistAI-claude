// "Ask your agent" against a real Postgres (the mock seed), through the REAL
// routes: switching the brick ON requires a secret, and never an unsigned call.
//   1. PUT /api/dashboard/tools, as the tenant AND as an admin (?asUserId=):
//      enable with no secret → `generatedSecret` (a string, top level, in
//      THAT response only), stored sealed, opening to the returned value;
//      enable with a provided secret → kept, nothing generated; an unchanged
//      re-send → no rotation (row byte for byte); omitted fields keep the
//      stored values; disabling never needs a secret.
//   2. no secret value in any GET, later PUT, event row or log line.
//   3. the inbound session config: a row with a secret serves clientAgent
//      (secret included) and the rest of the payload equals the off row's; an
//      enabled secret-less row (saved before ON required one) serves NO
//      clientAgent — the payload is byte-identical to the off row's — and
//      raises ONE deduplicated admin alert.
// Mock data only (example.test). Plain `npm test` skips it. Run it with:
//   npm run test:db -- --only client-agent-secret   (scripts/client-agent-secret-db.sh)

import assert from "node:assert/strict";
import dns from "node:dns";

const url = process.env.CLIENT_AGENT_SECRET_DB_TEST_URL;
if (!url) {
  console.log("skip: client agent secret DB part (no CLIENT_AGENT_SECRET_DB_TEST_URL — see scripts/client-agent-secret-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (Object.keys(process.env).some((k) => /^(LIVEKIT|TWILIO|RESEND|WHATSAPP|GOOGLE)|OPENAI|REALTIME_API_KEY|EMAIL_FROM|ADMIN_ALERT/i.test(k))) {
  throw new Error("refusing to run with provider env set");
}
if (!(globalThis as { __campgateHooks?: boolean }).__campgateHooks) throw new Error("module hooks missing: run through scripts/client-agent-secret-db.sh");
process.env.DATABASE_URL = url;
process.env.INTERNAL_SECRET = "mock-internal-secret";

// Every console line, to prove no secret reaches a log.
const logged: string[] = [];
for (const m of ["log", "info", "warn", "error", "debug"] as const) {
  const real = console[m].bind(console);
  console[m] = (...args: unknown[]) => {
    logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    real(...args);
  };
}

const g = globalThis as { __campgateSession?: { user: { id: string } } | null };
const sid = (s: string) => `00000000-0000-0000-0000-${s.padStart(12, "0")}`; // the seed's ids
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const A = sid("a"); // tenant (role user), fr
const SAFE = "https://agent.example.test/ask";
const PUBLIC_IP = "93.184.216.34";
// No real DNS: the mock agent's name "resolves" to a public address (the
// write path's url check goes through dns.promises.lookup, lib/net/safe-url.ts).
(dns.promises as { lookup: unknown }).lookup = async () => [{ address: PUBLIC_IP, family: 4 }];
const mask = (t: string) => t.replace(/"updatedAt":"[^"]+"/g, '"updatedAt":"*"');
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const { isSealed, openSecret } = await import("../../lib/crypto/secret-box");
  const { toolsFromTileToggles } = await import("../../lib/tools/adapters");
  const { getTileToggles } = await import("../../lib/tile-toggles");
  const { LEDGER_SETTING } = await import("../../lib/alert-ledger");
  const { getSetting } = await import("../../lib/settings");
  const { shouldDeliver } = await import("../../lib/monitoring-rules");
  const toolsRoute = await import("../../app/api/dashboard/tools/route");
  const { buildInboundConfig, LIVE_INBOUND_EFFECTS, clientAgentNoSecretAlertKey } = await import("../../lib/agent/session-config/inbound");

  const rows = async <T,>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
  await db.execute(sql`INSERT INTO users (id, email, password_hash, role) VALUES (${ADMIN}, 'admin@casec.example.test', 'x', 'admin')`);
  await db.execute(sql`UPDATE users SET subscription_status = 'active' WHERE id = ${A}`);

  const storedRaw = async () => (await rows<{ tc: string }>(sql`SELECT tools_config::text AS tc FROM agent_configs WHERE user_id = ${A}`))[0].tc;
  const storedCA = async () => (JSON.parse(await storedRaw()) as { clientAgent: { enabled: boolean; url: string; mode: string; secret: string | null } }).clientAgent;
  const base = toolsFromTileToggles(await getTileToggles(A));
  const setStored = (clientAgent: { enabled: boolean; url: string; mode: string; secret: string | null }) =>
    db.execute(sql`UPDATE agent_configs SET tools_config = ${JSON.stringify({ ...base, clientAgent })}::jsonb WHERE user_id = ${A}`);

  type Body = Record<string, unknown> & { tools?: { clientAgent?: Record<string, unknown> }; generatedSecret?: unknown };
  const call = async (as: string, method: "GET" | "PUT", tools?: unknown) => {
    g.__campgateSession = { user: { id: as } };
    const q = as === ADMIN ? `?asUserId=${A}` : "";
    const req = new NextRequest(`http://localhost/api/dashboard/tools${q}`, {
      method,
      ...(tools === undefined ? {} : { body: JSON.stringify({ tools }), headers: { "content-type": "application/json" } }),
    });
    const res = method === "GET" ? await toolsRoute.GET(req) : await toolsRoute.PUT(req);
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) as Body };
  };
  const allSecrets: string[] = [];

  // ── 1. The PUT, tenant and admin (?asUserId=) ──────────────────────────
  for (const as of [A, ADMIN]) {
    const who = as === A ? "tenant" : "admin";
    // Stored: off, a url set, no secret (no url in the patch → no DNS check).
    await setStored({ enabled: false, url: SAFE, mode: "voice", secret: null });

    // Enable with no secret → generated, returned ONCE, stored sealed.
    const on = await call(as, "PUT", { clientAgent: { enabled: true } });
    assert.equal(on.status, 200, `${who}: ${on.text}`);
    const gen = on.body.generatedSecret;
    assert.equal(typeof gen, "string", `${who}: generatedSecret is a string`);
    const secret = gen as string;
    allSecrets.push(secret);
    assert.match(secret, /^[A-Za-z0-9_-]{43}$/, "32 random bytes, base64url");
    assert.equal(on.body.tools!.clientAgent!.secretSet, true);
    assert.equal(on.body.tools!.clientAgent!.enabled, true);
    assert.equal("secret" in on.body.tools!.clientAgent!, false, "the tools view never carries the secret");
    assert.equal(on.text.split(secret).length - 1, 1, "the value appears once in the body: generatedSecret only");
    const ca = await storedCA();
    assert.ok(ca.secret && isSealed(ca.secret) && !ca.secret.includes(secret), `${who}: stored sealed`);
    const opened = openSecret(ca.secret!);
    assert.ok(opened.ok && opened.value === secret, `${who}: the stored secret opens to the returned value`);
    const afterOn = await storedRaw();

    // Never in a later GET.
    const get = await call(as, "GET");
    assert.equal(get.status, 200);
    assert.equal("generatedSecret" in get.body, false, `${who}: GET has no generatedSecret`);
    assert.ok(!get.text.includes(secret) && !get.text.includes(ca.secret!), `${who}: GET carries no secret value`);
    assert.equal(get.body.tools!.clientAgent!.secretSet, true);
    // The PUT body = the GET body + generatedSecret, nothing else.
    const { generatedSecret: _g, ...onRest } = on.body;
    void _g;
    assert.deepEqual(onRest, get.body, `${who}: the PUT body is the GET body plus the one-time field`);

    // An unchanged re-send (the screen echoes GET) → no rotation, row byte for byte.
    const resend = await call(as, "PUT", get.body.tools);
    assert.equal(resend.status, 200, resend.text);
    assert.equal("generatedSecret" in resend.body, false, `${who}: re-send → no generatedSecret`);
    assert.equal(await storedRaw(), afterOn, `${who}: re-send → stored row byte for byte`);
    // Omitted fields keep the stored values (and generate nothing).
    for (const patch of [{}, { booking: { minNoticeMinutes: (base.booking.minNoticeMinutes ?? 0) } }, { clientAgent: { mode: "lead" } }]) {
      const r = await call(as, "PUT", patch);
      assert.equal(r.status, 200, `${who} ${JSON.stringify(patch)}: ${r.text}`);
      assert.equal("generatedSecret" in r.body, false, `${who} ${JSON.stringify(patch)}: nothing generated`);
      const now = await storedCA();
      assert.equal(now.secret, ca.secret, `${who} ${JSON.stringify(patch)}: secret kept byte for byte`);
      assert.equal(now.enabled, true);
      assert.equal(now.url, SAFE);
    }

    // Disabling never needs a secret (clearing it with the switch off creates none).
    const off = await call(as, "PUT", { clientAgent: { enabled: false, secret: null } });
    assert.equal(off.status, 200, off.text);
    assert.equal("generatedSecret" in off.body, false, `${who}: disabling → nothing generated`);
    const offCA = await storedCA();
    assert.deepEqual([offCA.enabled, offCA.secret], [false, null]);

    // Enable with a PROVIDED secret → kept (sealed), nothing generated.
    const PROVIDED = `mock-provided-secret-${who}-0123456789`;
    allSecrets.push(PROVIDED);
    const prov = await call(as, "PUT", { clientAgent: { enabled: true, secret: PROVIDED } });
    assert.equal(prov.status, 200, prov.text);
    assert.equal("generatedSecret" in prov.body, false, `${who}: a provided secret → nothing generated`);
    assert.ok(!prov.text.includes(PROVIDED));
    const provCA = await storedCA();
    const po = openSecret(provCA.secret!);
    assert.ok(isSealed(provCA.secret!) && po.ok && po.value === PROVIDED, `${who}: the provided secret is kept`);
    console.log(`ok: ${who} PUT — generated once + sealed, provided kept, re-send no rotation, omitted kept, off needs none`);
  }
  // A tenant may not act on another account (unchanged).
  g.__campgateSession = { user: { id: A } };
  const forbidden = await toolsRoute.PUT(
    new NextRequest(`http://localhost/api/dashboard/tools?asUserId=${sid("b")}`, { method: "PUT", body: JSON.stringify({ tools: { clientAgent: { enabled: true } } }) }),
  );
  assert.equal(forbidden.status, 403);

  // ── 3. The inbound session config ──────────────────────────────────────
  const resolver = async () => [{ address: PUBLIC_IP, family: 4 as const }];
  type Alert = { key: string; subject: string; body: string };
  const build = async (alert: (a: Alert) => Promise<unknown>) =>
    mask(
      await (
        await buildInboundConfig(new URLSearchParams(`userId=${A}`), {
          ...LIVE_INBOUND_EFFECTS,
          urlCheck: { resolver },
          alertAdmins: alert as never,
        })
      ).text(),
    );
  const silent = async () => false;
  await db.execute(sql`DELETE FROM app_settings WHERE key = ${LEDGER_SETTING}`);

  await setStored({ enabled: false, url: SAFE, mode: "lead", secret: null });
  const pOff = await build(silent);
  assert.match(pOff, /"voiceConfig"/, "a real payload");
  assert.equal("clientAgent" in JSON.parse(pOff), false);

  // A row WITH a secret: served, secret included; the rest = the off payload.
  const SIGNED = "mock-signed-secret-0123456789";
  allSecrets.push(SIGNED);
  await setStored({ enabled: true, url: SAFE, mode: "lead", secret: SIGNED });
  const seenSigned: Alert[] = [];
  const pSigned = await build(async (a) => (seenSigned.push(a), true));
  const signed = JSON.parse(pSigned) as Record<string, unknown>;
  assert.deepEqual(signed.clientAgent, { url: SAFE, secret: SIGNED, mode: "lead" }, "a signed row is served as on main");
  const { clientAgent: _c, ...signedRest } = signed;
  void _c;
  assert.equal(JSON.stringify(signedRest), pOff, "…and the rest of the payload is the off row's, byte for byte");
  await tick();
  assert.equal(seenSigned.filter((a) => a.key.startsWith("client_agent_no_secret:")).length, 0, "a signed row raises no alert");

  // Enabled WITHOUT a secret (a legacy row): not served, payload = the off row's, ONE alert.
  await setStored({ enabled: true, url: SAFE, mode: "lead", secret: null });
  const seen: Alert[] = [];
  const pNoSecret = await build(async (a) => (seen.push(a), true));
  assert.equal(pNoSecret, pOff, "enabled without a secret → byte-identical to the off payload (no clientAgent)");
  await tick();
  const mine = seen.filter((a) => a.key.startsWith("client_agent_no_secret:"));
  assert.equal(mine.length, 1, "one alert");
  assert.equal(mine[0].key, clientAgentNoSecretAlertKey(A));
  assert.equal(mine[0].subject, "Client agent enabled without a secret");
  assert.doesNotMatch(`${mine[0].subject}\n${mine[0].body}`, /example\.test|https?:|@/, "no url nor email in the alert");
  // A sink that throws never changes the payload.
  assert.equal(await build(async () => { throw new Error("mock sink down"); }), pOff);
  // The live sink: deduplicated through the alert ledger (none in quiet hours).
  await db.execute(sql`DELETE FROM app_settings WHERE key = ${LEDGER_SETTING}`);
  for (let i = 0; i < 3; i++) {
    const live = mask(await (await buildInboundConfig(new URLSearchParams(`userId=${A}`), { ...LIVE_INBOUND_EFFECTS, urlCheck: { resolver } })).text());
    assert.equal(live, pOff, "live sink: payload byte-identical");
  }
  await tick(300);
  const delivered = shouldDeliver("warning", new Date());
  const raw = await getSetting(LEDGER_SETTING);
  const keys = raw ? Object.keys(JSON.parse(raw)).filter((k) => k.startsWith("client_agent_no_secret:")) : [];
  assert.deepEqual(keys, delivered ? [clientAgentNoSecretAlertKey(A)] : [], "ONE ledger entry per account per day");
  const [{ n }] = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM events WHERE event = 'admin_alert_sent' AND metadata->>'key' = ${clientAgentNoSecretAlertKey(A)}`);
  assert.equal(n, delivered ? 1 : 0, "the alert went out at most once");
  const [{ m }] = await rows<{ m: number }>(sql`SELECT count(*)::int AS m FROM events WHERE event = 'client_agent_no_secret' AND user_id = ${A}`);
  assert.ok(m >= 1, "the skip is logged");
  console.log(`ok: session config — signed row served, secret-less row not served (byte-identical to off) + ${delivered ? "one deduplicated alert" : "no alert in quiet hours"}`);

  // ── 2. No secret value in any event row or log line ────────────────────
  const [{ dump }] = await rows<{ dump: string }>(sql`SELECT coalesce(string_agg(coalesce(message, '') || ' ' || coalesce(metadata::text, ''), E'\n'), '') AS dump FROM events`);
  for (const s of allSecrets) {
    assert.ok(!dump.includes(s), "no secret value in the events table");
    assert.ok(!logged.some((l) => l.includes(s)), "no secret value in a log line");
  }
  assert.ok(!/enc:/.test(dump), "no sealed value in the events table");
  console.log(`ok: ${allSecrets.length} secret values, none in ${dump.split("\n").length} event rows nor ${logged.length} log lines`);
}

main().then(
  () => {
    console.log("ALL CLIENT-AGENT SECRET DB TESTS PASSED");
    process.exit(0);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
