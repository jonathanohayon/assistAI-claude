// E1: the three secrets at rest, through the helpers the routes use.
// Run with:  npx tsx scripts/tests/secrets-at-rest.test.ts
// For each secret: a new write with the key set is stored sealed; a read
// returns the plain value; a write without the key stays plain; a stored
// plain value still works with the key set; an unreadable one fails closed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { brainFromEntry, nextBrainSecret, storedBrainSecret, toWorkerWebhook } from "../../lib/agent-brain";
import { brainView } from "../../lib/agent-brain-guard";
import { isSealed, sealForStorage, sealSecret } from "../../lib/crypto/secret-box";
import { createUnreadableReporter, openStoredSecret } from "../../lib/crypto/unreadable-secret";
import { clientAgentCallField } from "../../lib/tools/adapters";
import {
  clientAgentSecretRefused,
  openClientAgentTools,
  sealClientAgentSecretWrite,
} from "../../lib/tools/client-agent-secret";
import { publicTools, type EffectiveCapabilities, type Tools } from "../../lib/tools/contract";
import { currentReceptionistTools, parseTools, planOutboundToolsWrite, planReceptionistToolsWrite } from "../../lib/tools/store";

const KEY = { SECRETS_KEY: randomBytes(32).toString("base64"), SECRETS_KEY_ID: "k1" };
const OTHER = { SECRETS_KEY: randomBytes(32).toString("base64"), SECRETS_KEY_ID: "k2" };
const NONE = {};
const S = "mock-hmac-secret-abcdef";
let alerts = 0;
const report = createUnreadableReporter(async () => {
  alerts++;
});
const quiet = createUnreadableReporter(async () => assert.fail("must not alert"));

// ── 1. agent brain (app_settings tenant_agent_brain) ──────────────────
{
  const URL = "https://agent.example.test/turn";
  // write path of setAgentBrain: nextBrainSecret → storedBrainSecret
  const write = (existing: string | undefined, provided: string | undefined, env: Record<string, string>) => {
    const secret = nextBrainSecret({ existing, provided, enabled: true, generate: () => "generated-mock" })!;
    return storedBrainSecret(secret, existing, env);
  };
  // new write, key set → sealed; read → plain; served plain
  const sealed = write(undefined, S, KEY);
  assert.ok(isSealed(sealed) && !sealed.includes(S));
  const brain = brainFromEntry({ enabled: true, url: URL, secret: sealed }, quiet, KEY);
  assert.deepEqual(brain, { enabled: true, url: URL, secret: S });
  assert.deepEqual(toWorkerWebhook(brain), { url: URL, secret: S });
  // a generated secret is sealed too
  assert.ok(isSealed(write(undefined, undefined, KEY)));
  // write without the key → plain (today)
  assert.equal(write(undefined, S, NONE), S);
  // stored plain + key set → still works, and a save that keeps it does NOT rewrite it
  assert.deepEqual(toWorkerWebhook(brainFromEntry({ enabled: true, url: URL, secret: S }, quiet, KEY)), { url: URL, secret: S });
  assert.equal(write(S, undefined, KEY), S);
  // a kept sealed secret is kept byte for byte (not re-sealed)
  assert.equal(write(sealed, undefined, KEY), sealed);
  // unreadable (key removed / other key) → not served, screen still "set", no value even to an admin
  const before = alerts;
  const lost = brainFromEntry({ enabled: true, url: URL, secret: sealed }, report, NONE);
  assert.equal(lost.secret, undefined);
  assert.equal(toWorkerWebhook(lost), undefined);
  assert.equal(brainView(lost, false).secretSet, true);
  assert.equal("secret" in brainView(lost, true), false);
  assert.equal(brainView(lost, true).secretSet, true);
  brainFromEntry({ enabled: true, url: URL, secret: sealed }, report, OTHER);
  assert.equal(alerts - before, 1, "one alert per kind");
  // readable: the view is unchanged from today
  assert.deepEqual(brainView(brain, true), { enabled: true, url: URL, urlSet: true, secretSet: true, secret: S });
  assert.deepEqual(brainView(brainFromEntry({ enabled: false, url: "" }, quiet, KEY), false), {
    enabled: false,
    url: "",
    urlSet: false,
    secretSet: false,
  });
}

// ── 2. client agent (agent_configs.tools_config.clientAgent.secret) ───
{
  const row = { toolsConfig: null, transferNumber: "", transferNumberParked: null };
  const toggles = { calendar: true, customers: true, orders: false };
  const caps = { clientAgent: { active: true } } as unknown as EffectiveCapabilities;
  const patch = { clientAgent: { enabled: true, url: "https://agent.example.test/ask", secret: S } };
  // write path of writeTools: planReceptionistToolsWrite → sealClientAgentSecretWrite
  const store = (r: typeof row | { toolsConfig: unknown; transferNumber: string; transferNumberParked: null }, p: unknown, env: Record<string, string>) => {
    const plan = planReceptionistToolsWrite(r, toggles, p);
    assert.ok(plan.ok);
    return sealClientAgentSecretWrite(plan.columns.toolsConfig, p, env);
  };
  const stored = store(row, patch, KEY);
  const json = JSON.parse(JSON.stringify(stored)) as Tools;
  assert.ok(isSealed(json.clientAgent.secret) && !JSON.stringify(json).includes(S));
  // the stored (sealed) value still parses; the screen says secretSet
  const readBack = { toolsConfig: json, transferNumber: "", transferNumberParked: null };
  assert.ok(parseTools(json).ok);
  const tools = currentReceptionistTools(readBack, toggles);
  assert.equal(publicTools(tools).clientAgent.secretSet, true);
  assert.ok(!JSON.stringify(publicTools(tools)).includes("enc:"));
  // served: the plain value
  const opened = openClientAgentTools(tools, quiet, KEY);
  assert.deepEqual(clientAgentCallField(caps, opened.tools), {
    clientAgent: { url: "https://agent.example.test/ask", secret: S, mode: "lead" },
  });
  // a later save that does not send the secret keeps the sealed value byte for byte
  const resave = store(readBack, { clientAgent: { mode: "lead", secretSet: true } }, KEY);
  assert.equal(resave.clientAgent.secret, json.clientAgent.secret);
  // write without the key → plain (today)
  assert.equal(store(row, patch, NONE).clientAgent.secret, S);
  // stored plain + key set → served as is, a save without secret keeps it plain
  const plainRow = { toolsConfig: store(row, patch, NONE), transferNumber: "", transferNumberParked: null };
  const plainTools = currentReceptionistTools(plainRow, toggles);
  assert.deepEqual(clientAgentCallField(caps, openClientAgentTools(plainTools, quiet, KEY).tools), {
    clientAgent: { url: "https://agent.example.test/ask", secret: S, mode: "lead" },
  });
  assert.equal(store(plainRow, { clientAgent: { mode: "lead" } }, KEY).clientAgent.secret, S);
  // null still clears
  assert.equal(store(readBack, { clientAgent: { secret: null } }, KEY).clientAgent.secret, null);
  // outbound writes seal the same way
  const ob = planOutboundToolsWrite(null, { clientAgent: { secret: S } });
  assert.ok(ob.ok && isSealed(sealClientAgentSecretWrite(ob.value, { clientAgent: { secret: S } }, KEY).clientAgent.secret));
  // a patch may not send a sealed-looking value
  assert.deepEqual(clientAgentSecretRefused({ clientAgent: { secret: sealSecret(S, KEY) } }), ["tools.clientAgent.secret"]);
  assert.deepEqual(clientAgentSecretRefused(patch), []);
  assert.deepEqual(clientAgentSecretRefused({ clientAgent: { mode: "lead" } }), []);
  // unreadable → NOT served at all; the screen still says secretSet
  const before = alerts;
  const lost = openClientAgentTools(tools, report, NONE);
  assert.equal(lost.unreadable, true);
  assert.equal(lost.tools.clientAgent.secret, null);
  openClientAgentTools(tools, report, OTHER);
  assert.equal(alerts - before, 1, "one alert per kind");
  assert.equal(publicTools(tools).clientAgent.secretSet, true);
}

// ── 3. Google refresh token (users.google_refresh_token) ──────────────
{
  const TOKEN = "1//mock-refresh-token";
  // writers (OAuth callback, restore-admin-google): sealForStorage
  const sealed = sealForStorage(TOKEN, KEY);
  assert.ok(isSealed(sealed) && !sealed.includes(TOKEN));
  // reader (getTenantGoogleClients, sheets route): openStoredSecret
  assert.equal(openStoredSecret("google", sealed, quiet, KEY), TOKEN);
  // write without the key → plain
  assert.equal(sealForStorage(TOKEN, NONE), TOKEN);
  // stored plain + key set → works
  assert.equal(openStoredSecret("google", TOKEN, quiet, KEY), TOKEN);
  // unreadable → null (= not connected); the presence flag (googleConnected) stays true
  const before = alerts;
  assert.equal(openStoredSecret("google", sealed, report, NONE), null);
  assert.equal(openStoredSecret("google", sealed, report, OTHER), null);
  assert.equal(alerts - before, 1);
  assert.equal(Boolean(sealed), true);
}

console.log("ALL SECRETS-AT-REST TESTS PASSED");
