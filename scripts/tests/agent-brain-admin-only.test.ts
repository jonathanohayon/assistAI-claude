// PUT /api/dashboard/agent-brain: a TENANT may only switch the own-agent
// brain OFF. Switching it on, changing the address, or changing / rotating the
// secret is admin-only: 403 { error: "admin_only", fields }, nothing written,
// no secret generated or re-sealed. An unchanged re-send is not a change
// (gate rule, case 2): the stored url (after normaliseAgentUrl), the stored
// secret (compared OPENED, so a sealed one too) and enabled:true on a brain
// already ON all pass, and write nothing. ADMIN: unchanged.
// Composes the route's own steps (getAgentBrain's brainFromEntry, enabledToSave,
// urlToSave, agentBrainSaveDecision, planAgentBrainEntry) as the route does;
// the route's source is asserted to match. Mock data only, no network, no DB.
// Run with:  npx tsx scripts/tests/agent-brain-admin-only.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { brainFromEntry, planAgentBrainEntry, toWorkerWebhook, type AgentBrain } from "../../lib/agent-brain";
import { agentBrainSaveDecision, brainSecretChanged, enabledToSave, urlToSave } from "../../lib/agent-brain-guard";
import { isSealed, sealForStorage } from "../../lib/crypto/secret-box";
import { type Resolver } from "../../lib/net/safe-url";

const ROOT = new URL("../../", import.meta.url).pathname;
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

const check = { resolver: (async () => [{ address: "93.184.215.14", family: 4 }]) as Resolver };
const KEY = { SECRETS_KEY: randomBytes(32).toString("base64"), SECRETS_KEY_ID: "k1" };
const SAFE = "https://agent.example.com/hook";
const OTHER_URL = "https://other.example.com/hook";
const S = "mock-secret-abc";
const quiet = () => {};
const TENANT_AND_ADMIN = [false, true] as const;
const who = (isAdmin: boolean) => (isAdmin ? "admin" : "tenant");

type Entry = Partial<AgentBrain>;

/** The route's PUT, I/O removed: body + stored entry → status, body, the entry after the PUT, secrets generated. */
async function brainPut(body: Record<string, unknown>, stored: Entry, isAdmin: boolean, env: Record<string, string> = {}) {
  let generated = 0;
  const generate = () => (generated++, "generated-mock");
  const current = brainFromEntry(stored, quiet, env); // getAgentBrain
  const wantsEnabled = enabledToSave(body.enabled, current.enabled);
  const url = urlToSave(body.url, current.url, isAdmin);
  const decision = await agentBrainSaveDecision({
    currentUrl: current.url,
    currentEnabled: current.enabled,
    currentSecret: current.secret,
    currentSecretUnreadable: current.secretUnreadable,
    secret: body.secret,
    url,
    wantsEnabled,
    isAdmin,
    check,
  });
  if (!decision.ok) return { status: decision.status, body: decision.body as unknown, stored, generated };
  if (decision.noop) return { status: 200, body: null, stored, generated };
  const plan = planAgentBrainEntry(
    stored,
    { enabled: wantsEnabled, url, ...(isAdmin && typeof body.secret === "string" ? { secret: body.secret } : {}) },
    { env, generate },
  );
  if (!plan.ok) return { status: 400, body: { error: plan.error } as unknown, stored, generated };
  return { status: 200, body: null, stored: plan.entry, generated };
}

const adminOnly = (fields: string[]) => ({ error: "admin_only", fields });

async function main() {
  const on: Entry = { enabled: true, url: SAFE, secret: S };
  const off: Entry = { enabled: false, url: SAFE, secret: S };

  // ── THE change: a tenant switching the brain on → 403 (was 200 on #414) ──
  for (const body of [{ enabled: true }, { enabled: true, url: SAFE }, { enabled: true, url: SAFE, secret: S }]) {
    const r = await brainPut(body, off, false);
    assert.deepEqual(r, { status: 403, body: adminOnly(["enabled"]), stored: off, generated: 0 }, `tenant enabling ${JSON.stringify(body)}`);
  }
  // ... with no secret stored: refused, and none generated
  {
    const bare: Entry = { enabled: false, url: SAFE };
    assert.deepEqual(await brainPut({ enabled: true }, bare, false), { status: 403, body: adminOnly(["enabled"]), stored: bare, generated: 0 });
    // the admin's same request is stored, a secret generated (as today)
    assert.deepEqual(await brainPut({ enabled: true }, bare, true), {
      status: 200, body: null, stored: { enabled: true, url: SAFE, secret: "generated-mock" }, generated: 1,
    });
  }

  // ── The route composes exactly these steps; anon → 401 first ───────────
  {
    const route = src("app/api/dashboard/agent-brain/route.ts");
    const put = route.slice(route.indexOf("export async function PUT"));
    assert.ok(put.indexOf('{ error: "Unauthorized" }, { status: 401 }') < put.indexOf("getAgentBrain("), "anon: 401 before anything is read");
    assert.ok(put.indexOf('{ error: "Unauthorized" }, { status: 401 }') < put.indexOf("setAgentBrain("), "anon: 401 before the write");
    assert.match(put, /const \[current, isAdmin\] = await Promise\.all\(\[getAgentBrain\(session\.user\.id\), sessionIsAdmin\(\)\]\);/);
    assert.match(
      put,
      /agentBrainSaveDecision\(\{\s*currentUrl: current\.url,\s*currentEnabled: current\.enabled,\s*currentSecret: current\.secret,\s*currentSecretUnreadable: current\.secretUnreadable,\s*secret: body\.secret,\s*url,\s*wantsEnabled,\s*isAdmin,\s*\}\)/,
    );
    // a refusal returns before any write; a noop returns before any write
    assert.ok(put.indexOf("return NextResponse.json(decision.body, { status: decision.status });") < put.indexOf("setAgentBrain("));
    assert.ok(put.indexOf("if (decision.noop) return") < put.indexOf("setAgentBrain("));
    // a tenant never hands a secret to the store
    assert.match(put, /\.\.\.\(isAdmin && typeof body\.secret === "string" \? \{ secret: body\.secret \} : \{\}\),/);
    // the 403 carries no message, and the secret never reaches a log
    assert.doesNotMatch(route, /admin_only[^\n]*message/);
    assert.doesNotMatch(route, /metadata: \{[^}]*secret/);
    // GET unchanged
    assert.match(route, /return NextResponse\.json\(\{ brain: brainView\(brain, isAdmin\), urlEditable: isAdmin \}\);\s*\}\s*\n\s*export async function PUT/);
  }

  // ── Gate case 1: forbidden for a tenant, nothing written ────────────────
  for (const stored of [on, off]) {
    // url change
    assert.deepEqual((await brainPut({ url: OTHER_URL }, stored, false)).body, adminOnly(["url"]));
    assert.deepEqual((await brainPut({ enabled: false, url: OTHER_URL }, stored, false)).body, adminOnly(["url"]));
    // a different path case IS a different address
    assert.deepEqual((await brainPut({ url: "https://agent.example.com/HOOK" }, stored, false)).body, adminOnly(["url"]));
    // secret change / rotation, with or without enabled:false
    for (const body of [{ secret: "new-mock" }, { enabled: false, secret: "new-mock" }, { secret: ` ${S}x ` }]) {
      const r = await brainPut(body, stored, false);
      assert.deepEqual(r, { status: 403, body: adminOnly(["secret"]), stored, generated: 0 }, `tenant ${JSON.stringify(body)}`);
    }
  }
  // every field at once: all reported
  assert.deepEqual((await brainPut({ enabled: true, url: OTHER_URL, secret: "new-mock" }, off, false)).body, adminOnly(["enabled", "url", "secret"]));
  // a tenant setting a FIRST secret (none stored) is a change too
  assert.deepEqual((await brainPut({ secret: "new-mock" }, { enabled: false, url: SAFE }, false)).body, adminOnly(["secret"]));
  // a url-less stored row: a tenant adding an address is a change
  assert.deepEqual((await brainPut({ url: SAFE }, { enabled: false, url: "" }, false)).body, adminOnly(["url"]));

  // ── Gate case 2: the tenant's one write (off), and unchanged re-sends ───
  for (const body of [
    { enabled: false },
    { enabled: false, url: SAFE },
    { enabled: false, secret: S },
    { enabled: false, url: SAFE, secret: S },
    { enabled: false, url: "" }, // the tenant's screen never holds the url: "" keeps it
    { enabled: false, url: "HTTPS://Agent.Example.COM/hook" }, // same address, other case
    { enabled: false, secret: "   " }, // blank = keep
  ]) {
    const r = await brainPut(body, on, false);
    assert.deepEqual(r, { status: 200, body: null, stored: { ...on, enabled: false }, generated: 0 }, `tenant off ${JSON.stringify(body)}`);
  }
  // re-sending enabled:true while it's already ON is not a switch-on: passes, writes nothing
  for (const body of [
    {},
    { enabled: true },
    { enabled: true, url: SAFE, secret: S },
    { url: "HTTPS://AGENT.EXAMPLE.COM/hook" },
    { secret: S },
  ]) {
    const r = await brainPut(body, on, false);
    assert.deepEqual(r, { status: 200, body: null, stored: on, generated: 0 }, `tenant unchanged ON ${JSON.stringify(body)}`);
  }
  // an unchanged re-send on an OFF row: passes, writes nothing
  for (const body of [{}, { enabled: false }, { enabled: false, url: SAFE, secret: S }, { secret: S }]) {
    assert.deepEqual(await brainPut(body, off, false), { status: 200, body: null, stored: off, generated: 0 }, `tenant unchanged OFF ${JSON.stringify(body)}`);
  }
  // an ON row without a secret (older rows): a tenant re-send generates NONE
  {
    const bareOn: Entry = { enabled: true, url: SAFE };
    assert.deepEqual(await brainPut({ enabled: true }, bareOn, false), { status: 200, body: null, stored: bareOn, generated: 0 });
    assert.deepEqual(await brainPut({ enabled: false }, bareOn, false), { status: 200, body: null, stored: { enabled: false, url: SAFE }, generated: 0 });
  }

  // ── The secret compared safely: stored SEALED (E1) ─────────────────────
  {
    const sealed = sealForStorage(S, KEY);
    assert.ok(isSealed(sealed) && !sealed.includes(S));
    const sealedOn: Entry = { enabled: true, url: SAFE, secret: sealed };
    // the same value, re-sent in clear: unchanged → passes; the stored bytes are kept (not re-sealed)
    const r = await brainPut({ enabled: false, secret: S }, sealedOn, false, KEY);
    assert.deepEqual(r, { status: 200, body: null, stored: { ...sealedOn, enabled: false }, generated: 0 });
    assert.deepEqual(await brainPut({ secret: S }, sealedOn, false, KEY), { status: 200, body: null, stored: sealedOn, generated: 0 });
    // a different value → 403
    assert.deepEqual((await brainPut({ secret: "new-mock" }, sealedOn, false, KEY)).body, adminOnly(["secret"]));
    // re-sending the SEALED string itself is not the secret: a change → 403 (the route refuses it earlier, 400)
    assert.deepEqual((await brainPut({ secret: sealed }, sealedOn, false, KEY)).body, adminOnly(["secret"]));
    // stored but unreadable (key missing): can't be proven equal → any value is a change; omitted / off still passes
    assert.deepEqual((await brainPut({ secret: S }, sealedOn, false, {})).body, adminOnly(["secret"]));
    assert.deepEqual(await brainPut({ enabled: false }, sealedOn, false, {}), {
      status: 200, body: null, stored: { ...sealedOn, enabled: false }, generated: 0,
    });
    // brainSecretChanged: absent / non-string / blank never a change; constant-time on equal or unequal lengths
    for (const v of [undefined, null, 42, "", "   "]) assert.equal(brainSecretChanged(v, { secret: S }), false, String(v));
    assert.equal(brainSecretChanged(S, { secret: S }), false);
    assert.equal(brainSecretChanged(` ${S} `, { secret: S }), false, "trimmed, as the store reads it");
    assert.equal(brainSecretChanged("x", { secret: S }), true);
    assert.equal(brainSecretChanged(S, {}), true, "no stored secret: setting one is a change");
    assert.equal(brainSecretChanged(S, { secretUnreadable: true }), true);
  }

  // ── Gate case 3: a tenant's refusal outranks the address rules (nothing written) ──
  {
    const unsafe: Entry = { enabled: false, url: "http://127.0.0.1/hook", secret: S };
    assert.deepEqual((await brainPut({ enabled: true }, unsafe, false)).body, adminOnly(["enabled"]));
    assert.deepEqual((await brainPut({ enabled: true }, unsafe, true)).status, 400, "admin: unsafe_url as today");
    // a tenant re-send keeping an unsafe webhook ON is still 400 (the address rules apply), turning it off passes
    const unsafeOn: Entry = { ...unsafe, enabled: true };
    assert.equal((await brainPut({ enabled: true }, unsafeOn, false)).status, 400);
    assert.deepEqual((await brainPut({ enabled: false }, unsafeOn, false)).stored, unsafe);
  }

  // ── Gate case 4: omitted = unchanged, tenant AND admin ─────────────────
  for (const isAdmin of TENANT_AND_ADMIN) {
    for (const stored of [on, off, { enabled: false, url: "" } as Entry]) {
      const r = await brainPut({}, stored, isAdmin);
      assert.equal(r.status, 200, `${who(isAdmin)} {} on ${JSON.stringify(stored)}`);
      assert.deepEqual(r.stored, { ...stored, url: stored.url }, `${who(isAdmin)}: omitted keeps everything`);
      assert.equal(r.generated, 0);
    }
  }

  // ── ADMIN: every write as today ─────────────────────────────────────────
  assert.deepEqual(await brainPut({ enabled: true }, off, true), { status: 200, body: null, stored: on, generated: 0 });
  assert.deepEqual(await brainPut({ enabled: false }, on, true), { status: 200, body: null, stored: off, generated: 0 });
  assert.deepEqual(await brainPut({ url: OTHER_URL }, on, true), { status: 200, body: null, stored: { ...on, url: OTHER_URL }, generated: 0 });
  assert.deepEqual(await brainPut({ secret: "new-mock" }, on, true), { status: 200, body: null, stored: { ...on, secret: "new-mock" }, generated: 0 });
  assert.deepEqual(await brainPut({ enabled: true, url: "HTTPS://Other.Example.com/X", secret: "new-mock" }, { enabled: false, url: "" }, true), {
    status: 200, body: null, stored: { enabled: true, url: "https://other.example.com/X", secret: "new-mock" }, generated: 0,
  });
  assert.deepEqual(await brainPut({ enabled: true, url: "" }, on, true), { status: 400, body: { error: "address_required" }, stored: on, generated: 0 });
  assert.deepEqual(await brainPut({ enabled: false, url: "" }, on, true), { status: 200, body: null, stored: { enabled: false, url: "", secret: S }, generated: 0 });
  // an admin's new secret is sealed when the key is set (E1, unchanged)
  {
    const r = await brainPut({ secret: "new-mock" }, on, true, KEY);
    assert.ok(r.status === 200 && isSealed(r.stored.secret) && !String(r.stored.secret).includes("new-mock"));
  }

  // ── Worker payload: toWorkerWebhook unchanged for every stored state ───
  const served = (e: Entry, env: Record<string, string> = {}) => toWorkerWebhook(brainFromEntry(e, quiet, env));
  assert.deepEqual(served(on), { url: SAFE, secret: S });
  assert.deepEqual(served({ enabled: true, url: SAFE }), { url: SAFE });
  assert.equal(served(off), undefined);
  assert.equal(served({ enabled: true, url: "" }), undefined);
  assert.equal(served({}), undefined);
  assert.deepEqual(served({ enabled: true, url: SAFE, secret: sealForStorage(S, KEY) }, KEY), { url: SAFE, secret: S });
  assert.equal(served({ enabled: true, url: SAFE, secret: sealForStorage(S, KEY) }, {}), undefined, "unreadable: not served");
  // ... and after every tenant PUT the payload is either unchanged or switched off
  for (const stored of [on, off, { enabled: true, url: SAFE } as Entry]) {
    for (const body of [{}, { enabled: true }, { enabled: false }, { secret: S }, { url: OTHER_URL }, { secret: "new-mock" }, { enabled: true, url: OTHER_URL }]) {
      const r = await brainPut(body, stored, false);
      const after = served(r.stored);
      assert.ok(
        JSON.stringify(after) === JSON.stringify(served(stored)) || after === undefined,
        `tenant ${JSON.stringify(body)} on ${JSON.stringify(stored)}: payload unchanged or off`,
      );
    }
  }

  console.log("ALL AGENT-BRAIN-ADMIN-ONLY TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
