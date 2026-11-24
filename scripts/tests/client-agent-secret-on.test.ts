// Switching the client agent ON requires a secret: the receptionist write
// composition writeTools runs (planReceptionistToolsWrite →
// sealClientAgentSecretWrite → ensureClientAgentSecret), and the serving
// side (clientAgentCallField + the no-secret skip in the inbound resolver,
// source asserted). The real route + DB: scripts/client-agent-secret-db.sh.
// Run with:  npx tsx scripts/tests/client-agent-secret-on.test.ts
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { isSealed, openSecret } from "../../lib/crypto/secret-box";
import {
  ensureClientAgentSecret,
  generateClientAgentSecret,
  sealClientAgentSecretWrite,
} from "../../lib/tools/client-agent-secret";
import { publicTools, type Tools } from "../../lib/tools/contract";
import { currentReceptionistTools, planReceptionistToolsWrite, type ReceptionistToolSettings } from "../../lib/tools/store";
import { DEFAULT_TILE_TOGGLES } from "../../lib/tile-toggles";
import { generateClientAgentSecret as screenGenerate } from "../../components/bricks/tools/tools-ui";

const KEY = { SECRETS_KEY: randomBytes(32).toString("base64"), SECRETS_KEY_ID: "k1" };
const NONE = {};
const T = DEFAULT_TILE_TOGGLES;
const URL_OK = "https://agent.example.test/ask";
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

let n = 0;
const mockGen = () => `mock-generated-${++n}`;

/** One receptionist save, exactly as writeTools composes it. */
function save(row: ReceptionistToolSettings, patch: unknown, env: Record<string, string> = KEY) {
  const plan = planReceptionistToolsWrite(row, T, patch);
  assert.ok(plan.ok, JSON.stringify(plan));
  const ensured = ensureClientAgentSecret(sealClientAgentSecretWrite(plan.columns.toolsConfig, patch, env), mockGen, env);
  const stored = JSON.parse(JSON.stringify(ensured.tools)) as Tools;
  return { row: { ...row, ...plan.columns, toolsConfig: stored } as ReceptionistToolSettings, stored, generated: ensured.generated };
}
const empty: ReceptionistToolSettings = { toolsConfig: null, transferNumber: "", transferNumberParked: null };
const withUrl = save(empty, { clientAgent: { url: URL_OK } }).row;

// 1. The generator: the screen's format (32 bytes, base64url, no padding).
for (let i = 0; i < 20; i++) {
  const s = generateClientAgentSecret();
  assert.match(s, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(s, "base64url").length, 32);
  assert.equal(s.length, screenGenerate().length);
}
assert.notEqual(generateClientAgentSecret(), generateClientAgentSecret());

// 2. Enable with no secret → generated, stored SEALED, returned once (plain).
{
  const on = save(withUrl, { clientAgent: { enabled: true } });
  assert.ok(on.generated, "a secret is generated");
  const stored = on.stored.clientAgent.secret!;
  assert.ok(isSealed(stored) && !stored.includes(on.generated!), "stored sealed, the plain value not in it");
  const opened = openSecret(stored, KEY);
  assert.ok(opened.ok && opened.value === on.generated, "the stored secret opens to the returned value");
  assert.equal(on.stored.clientAgent.enabled, true);
  assert.equal(on.stored.clientAgent.url, URL_OK);
  // The screen view (GET / the PUT's tools): secretSet, never a value.
  const pub = publicTools(currentReceptionistTools(on.row, T));
  assert.equal(pub.clientAgent.secretSet, true);
  assert.ok(!JSON.stringify(pub).includes(on.generated!) && !JSON.stringify(pub).includes("enc:"));
  assert.equal("secret" in pub.clientAgent, false);

  // 3. An unchanged re-send (the GET echo) → no rotation, kept byte for byte.
  for (const patch of [
    { clientAgent: { enabled: true, url: URL_OK, mode: on.stored.clientAgent.mode, secretSet: true } },
    { clientAgent: { enabled: true } },
    { clientAgent: {} },
  ]) {
    const again = save(on.row, patch);
    assert.equal(again.generated, null, JSON.stringify(patch));
    assert.equal(again.stored.clientAgent.secret, stored, "kept byte for byte");
  }
  // 4. Omitted fields keep the stored values (and never generate).
  for (const patch of [{}, { booking: { enabled: false } }, { clientAgent: { mode: "lead" } }]) {
    const w = save(on.row, patch);
    assert.equal(w.generated, null, JSON.stringify(patch));
    assert.equal(w.stored.clientAgent.secret, stored);
    assert.equal(w.stored.clientAgent.enabled, true);
    assert.equal(w.stored.clientAgent.url, URL_OK);
  }
  // 5. Disabling never needs a secret (and clearing it while off creates none).
  for (const patch of [{ clientAgent: { enabled: false } }, { clientAgent: { enabled: false, secret: null } }]) {
    const off = save(on.row, patch);
    assert.equal(off.generated, null, JSON.stringify(patch));
    assert.equal(off.stored.clientAgent.enabled, false);
  }
  const offCleared = save(on.row, { clientAgent: { enabled: false, secret: null } });
  assert.equal(offCleared.stored.clientAgent.secret, null);
  // …and switching it back on later generates a NEW one.
  const back = save(offCleared.row, { clientAgent: { enabled: true } });
  assert.ok(back.generated && back.generated !== on.generated);
  // Clearing the secret while keeping it ON → a new one (ON requires a secret).
  const cleared = save(on.row, { clientAgent: { secret: null } });
  assert.ok(cleared.generated && cleared.stored.clientAgent.secret && isSealed(cleared.stored.clientAgent.secret));
}

// 6. Enable with a provided secret → kept (sealed), nothing generated.
{
  const PROVIDED = "mock-provided-secret-0123456789";
  const w = save(withUrl, { clientAgent: { enabled: true, secret: PROVIDED } });
  assert.equal(w.generated, null);
  const o = openSecret(w.stored.clientAgent.secret!, KEY);
  assert.ok(o.ok && o.value === PROVIDED);
  // a kept PLAIN secret (stored before E1) is kept as is
  const plain = save(withUrl, { clientAgent: { enabled: true, secret: PROVIDED } }, NONE);
  assert.equal(plain.stored.clientAgent.secret, PROVIDED);
  const resend = save(plain.row, { clientAgent: { enabled: true } });
  assert.equal(resend.generated, null);
  assert.equal(resend.stored.clientAgent.secret, PROVIDED);
}

// 7. No SECRETS_KEY: the generated secret is stored plain (as E1 does for a provided one).
{
  const w = save(withUrl, { clientAgent: { enabled: true } }, NONE);
  assert.ok(w.generated);
  assert.equal(w.stored.clientAgent.secret, w.generated);
}

// 8. The off row never changes (byte for byte): no generation when not enabled.
{
  const w = save(withUrl, { booking: { enabled: false } });
  assert.equal(w.generated, null);
  assert.equal(w.stored.clientAgent.secret, null);
}

// 9. writeTools and the route compose exactly these helpers; the one-time
// field is `generatedSecret`, set only from the write result.
{
  const w = src("lib/tools/write.ts");
  assert.match(w, /const ensured = ensureClientAgentSecret\(sealClientAgentSecretWrite\(plan\.columns\.toolsConfig, patch\)\);/);
  assert.match(w, /toolsConfig: jsonb\(ensured\.tools\),/);
  assert.match(w, /return ensured\.generated \? \{ ok: true, generatedSecret: ensured\.generated \} : \{ ok: true \};/);
  const r = src("app/api/dashboard/tools/route.ts");
  assert.match(r, /return view\(s, \{ generatedSecret: w\.generatedSecret \}\);/);
  assert.match(r, /\.\.\.\(once\.generatedSecret \? \{ generatedSecret: once\.generatedSecret \} : \{\}\),/);
  // GET passes no one-time value.
  assert.match(r, /export async function GET\(req: NextRequest\) \{\n  const s = await scope\(req\);\n  if \("error" in s\) return s\.error;\n  return view\(s\);\n\}/);
  // The tools_updated event carries no secret.
  const ev = r.slice(r.indexOf("await logEvent({"), r.indexOf("return view(s, {"));
  assert.doesNotMatch(ev, /secret/i);
  // Serving: an enabled, secret-less client agent is not served.
  const inbound = src("lib/agent/session-config/inbound.ts");
  assert.match(inbound, /if \("clientAgent" in clientAgentField && !opened\.tools\.clientAgent\.secret\) \{\n    clientAgentField = \{\};/);
}

console.log("ALL CLIENT-AGENT SECRET-ON TESTS PASSED");
