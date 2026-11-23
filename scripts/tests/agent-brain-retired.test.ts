// PUT /api/dashboard/agent-brain: the old own-agent mechanism is RETIRED.
// For EVERYONE (tenant and admin): switching it on, or changing the url or the
// secret on any row (on or off) → 409 { error: "agent_brain_retired" }, no
// message, nothing written, no secret generated. Switching it OFF → 200 (the
// only write left); an unchanged re-send → 200, nothing written. GET and
// toWorkerWebhook are unchanged. Also: enabledLegacyBrainCount and the
// admins' daily digest line (a count only, shown only when > 0, deduped by
// the existing daily_digest alert key).
// Composes the route's own steps as the route does; the route's source is
// asserted to match. The route has no asUserId (own account only), asserted.
// Mock data only, no network, no DB.
// Run with:  npx tsx scripts/tests/agent-brain-retired.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  brainFromEntry,
  enabledLegacyBrainCount,
  planAgentBrainEntry,
  toWorkerWebhook,
  type AgentBrain,
} from "../../lib/agent-brain";
import {
  agentBrainRetiredDecision,
  agentBrainSaveDecision,
  brainView,
  enabledToSave,
  urlToSave,
} from "../../lib/agent-brain-guard";
import { formatDigest, legacyBrainDigestLine, type DigestInput } from "../../lib/monitoring-rules";
import { type Resolver } from "../../lib/net/safe-url";

const ROOT = new URL("../../", import.meta.url).pathname;
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

const check = { resolver: (async () => [{ address: "93.184.215.14", family: 4 }]) as Resolver };
const SAFE = "https://agent.example.com/hook";
const OTHER_URL = "https://other.example.com/hook";
const S = "mock-secret-abc";
const quiet = () => {};
const RETIRED = { error: "agent_brain_retired" };
const TENANT_AND_ADMIN = [false, true] as const;
const who = (isAdmin: boolean) => (isAdmin ? "admin" : "tenant");

type Entry = Partial<AgentBrain>;

/** The route's PUT, I/O removed: body + stored entry → status, body, entry after, secrets generated. */
async function brainPut(body: Record<string, unknown>, stored: Entry, isAdmin: boolean) {
  let generated = 0;
  const generate = () => (generated++, "generated-mock");
  const current = brainFromEntry(stored, quiet, {});
  const wantsEnabled = enabledToSave(body.enabled, current.enabled);
  const url = urlToSave(body.url, current.url, isAdmin);
  const retired = agentBrainRetiredDecision({
    currentUrl: current.url,
    currentEnabled: current.enabled,
    currentSecret: current.secret,
    currentSecretUnreadable: current.secretUnreadable,
    secret: body.secret,
    url,
    wantsEnabled,
  });
  if (!retired.ok) return { status: retired.status, body: retired.body as unknown, stored, generated };
  if (!retired.write) return { status: 200, body: null, stored, generated };
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
    { env: {}, generate },
  );
  if (!plan.ok) return { status: 400, body: { error: plan.error } as unknown, stored, generated };
  return { status: 200, body: null, stored: plan.entry, generated };
}

async function main() {
  const on: Entry = { enabled: true, url: SAFE, secret: S };
  const off: Entry = { enabled: false, url: SAFE, secret: S };
  const bareOff: Entry = { enabled: false, url: SAFE };
  const empty: Entry = {};

  // ── Switch-on refused for tenant AND admin, nothing written ────────────
  for (const isAdmin of TENANT_AND_ADMIN) {
    for (const stored of [off, bareOff, empty]) {
      for (const body of [{ enabled: true }, { enabled: true, url: SAFE }, { enabled: true, url: SAFE, secret: S }]) {
        const r = await brainPut(body, stored, isAdmin);
        assert.deepEqual(
          r,
          { status: 409, body: RETIRED, stored, generated: 0 },
          `${who(isAdmin)} switch-on ${JSON.stringify(body)} on ${JSON.stringify(stored)}`,
        );
      }
    }
  }

  // ── url / secret edits refused on an OFF row and on an ON row ──────────
  for (const isAdmin of TENANT_AND_ADMIN) {
    for (const stored of [off, on, bareOff]) {
      for (const body of [
        { url: OTHER_URL },
        { enabled: false, url: OTHER_URL },
        { secret: "new-mock" },
        { enabled: false, secret: "new-mock" },
        { url: "https://agent.example.com/HOOK" }, // path case = another address
      ]) {
        const r = await brainPut(body, stored, isAdmin);
        assert.deepEqual(r, { status: 409, body: RETIRED, stored, generated: 0 }, `${who(isAdmin)} edit ${JSON.stringify(body)}`);
      }
    }
  }
  // an admin clearing the url ("" clears for an admin) is an edit too
  assert.deepEqual(await brainPut({ url: "" }, off, true), { status: 409, body: RETIRED, stored: off, generated: 0 });
  assert.deepEqual(await brainPut({ enabled: false, url: "" }, on, true), { status: 409, body: RETIRED, stored: on, generated: 0 });
  // a tenant's "" keeps the stored url (its screen never holds it): not an edit
  assert.deepEqual(await brainPut({ enabled: false, url: "" }, on, false), {
    status: 200, body: null, stored: { ...on, enabled: false }, generated: 0,
  });
  // a stored secret that can't be opened: any non-blank secret is a change
  {
    const r = agentBrainRetiredDecision({
      currentUrl: SAFE, currentEnabled: false, currentSecretUnreadable: true, secret: S, url: SAFE, wantsEnabled: false,
    });
    assert.deepEqual(r, { ok: false, status: 409, body: RETIRED });
  }

  // ── OFF allowed for everyone: the only write ───────────────────────────
  for (const isAdmin of TENANT_AND_ADMIN) {
    for (const body of [
      { enabled: false },
      { enabled: false, url: SAFE },
      { enabled: false, secret: S },
      { enabled: false, url: "HTTPS://Agent.Example.COM/hook" }, // same address, other case
      { enabled: false, secret: "   " }, // blank = keep
    ]) {
      const r = await brainPut(body, on, isAdmin);
      assert.deepEqual(r, { status: 200, body: null, stored: { ...on, enabled: false }, generated: 0 }, `${who(isAdmin)} off ${JSON.stringify(body)}`);
    }
    // a legacy row ON with no secret stored: switching off generates none
    const bareOn: Entry = { enabled: true, url: SAFE };
    assert.deepEqual(await brainPut({ enabled: false }, bareOn, isAdmin), {
      status: 200, body: null, stored: { enabled: false, url: SAFE }, generated: 0,
    });
  }

  // ── Unchanged re-sends: 200, nothing written, no secret generated ──────
  for (const isAdmin of TENANT_AND_ADMIN) {
    for (const [stored, body] of [
      [on, {}],
      [on, { enabled: true }],
      [on, { enabled: true, url: SAFE, secret: S }],
      [{ enabled: true, url: SAFE }, { enabled: true }], // admin used to get a secret generated here
      [off, { enabled: false }],
      [off, {}],
      [empty, { enabled: false }],
    ] as Array<[Entry, Record<string, unknown>]>) {
      const r = await brainPut(body, stored, isAdmin);
      assert.deepEqual(r, { status: 200, body: null, stored, generated: 0 }, `${who(isAdmin)} resend ${JSON.stringify(body)}`);
    }
  }

  // ── The route composes exactly these steps ─────────────────────────────
  {
    const route = src("app/api/dashboard/agent-brain/route.ts");
    const put = route.slice(route.indexOf("export async function PUT"));
    assert.match(
      put,
      /agentBrainRetiredDecision\(\{\s*currentUrl: current\.url,\s*currentEnabled: current\.enabled,\s*currentSecret: current\.secret,\s*currentSecretUnreadable: current\.secretUnreadable,\s*secret: body\.secret,\s*url,\s*wantsEnabled,\s*\}\)/,
    );
    const iRetired = put.indexOf("agentBrainRetiredDecision(");
    const iRefuse = put.indexOf("return NextResponse.json(retired.body, { status: retired.status });");
    const iNoop = put.indexOf("if (!retired.write) return NextResponse.json(");
    const iDecision = put.indexOf("agentBrainSaveDecision(");
    const iWrite = put.indexOf("setAgentBrain(");
    assert.ok(put.indexOf("getAgentBrain(") < iRetired, "the stored row is read first");
    assert.ok(iRetired < iRefuse && iRefuse < iNoop && iNoop < iDecision && iDecision < iWrite, "retired check → refuse → noop → rules → write");
    // the 409 carries no message; the secret never reaches a log
    assert.doesNotMatch(route, /agent_brain_retired[^\n]*message/);
    assert.doesNotMatch(route, /metadata: \{[^}]*secret/);
    // own account only: no asUserId on this route
    assert.doesNotMatch(route, /asUserId|resolveScopeUserId/);
    // GET unchanged
    assert.match(
      route,
      /export async function GET\(\) \{\s*const session = await auth\(\);\s*if \(!session\?\.user\?\.id\) \{\s*return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\);\s*\}\s*const \[brain, isAdmin\] = await Promise\.all\(\[getAgentBrain\(session\.user\.id\), sessionIsAdmin\(\)\]\);\s*\/\/[^\n]*\n\s*return NextResponse\.json\(\{ brain: brainView\(brain, isAdmin\), urlEditable: isAdmin \}\);\s*\}/,
    );
  }
  // GET's view, unchanged
  assert.deepEqual(brainView(brainFromEntry(on, quiet, {}), false), { enabled: true, url: "", urlSet: true, secretSet: true });
  assert.deepEqual(brainView(brainFromEntry(on, quiet, {}), true), { enabled: true, url: SAFE, urlSet: true, secretSet: true, secret: S });

  // ── toWorkerWebhook unchanged: an enabled legacy row is still served ───
  assert.deepEqual(toWorkerWebhook(brainFromEntry(on, quiet, {})), { url: SAFE, secret: S });
  assert.deepEqual(toWorkerWebhook(brainFromEntry({ enabled: true, url: SAFE }, quiet, {})), { url: SAFE });
  assert.equal(toWorkerWebhook(brainFromEntry(off, quiet, {})), undefined);
  assert.equal(toWorkerWebhook({ enabled: true, url: "ftp://x" }), undefined);
  assert.equal(toWorkerWebhook({ enabled: true, url: SAFE, secretUnreadable: true }), undefined);

  // ── enabledLegacyBrainCount ────────────────────────────────────────────
  assert.equal(enabledLegacyBrainCount({}), 0);
  assert.equal(enabledLegacyBrainCount(null), 0);
  assert.equal(enabledLegacyBrainCount(undefined), 0);
  assert.equal(enabledLegacyBrainCount([{ enabled: true }]), 0);
  assert.equal(enabledLegacyBrainCount("nope"), 0);
  assert.equal(
    enabledLegacyBrainCount({
      "u-1": { enabled: true, url: SAFE },
      "u-2": { enabled: false, url: SAFE },
      "u-3": { enabled: true, url: "" }, // stored on, even without an address
      "u-4": { enabled: "true" as unknown as boolean }, // only a real true counts
      "u-5": null as unknown as Entry,
      "u-6": {},
    }),
    2,
  );

  // ── The digest line: count only, shown only when N > 0 ─────────────────
  const base: DigestInput = {
    calls: 3, callSeconds: 120, bookings: 1, errors: 0, topErrors: [], heartbeatAgeMin: 2, synthetic: null,
  };
  const line = legacyBrainDigestLine(2);
  assert.equal(line, "Ancien mécanisme « votre agent » : 2 compte(s) encore activé(s)");
  assert.equal(formatDigest(base), formatDigest({ ...base, legacyBrainEnabled: 0 }), "N = 0: no line, digest unchanged");
  assert.doesNotMatch(formatDigest(base), /votre agent/);
  const withLine = formatDigest({ ...base, legacyBrainEnabled: 2 });
  assert.equal(withLine, `${formatDigest(base)}\n${line}`);
  // no PII: the line holds the count and fixed text only
  assert.equal(line.replace(/\d+/g, "N"), "Ancien mécanisme « votre agent » : N compte(s) encore activé(s)");
  assert.doesNotMatch(withLine, /https?:|@|u-\d/);
  // wired into the daily digest, which stays deduped (daily_digest, 20 h) as before
  {
    const mon = src("lib/monitoring.ts");
    const run = mon.slice(mon.indexOf("export async function runDailyDigest"));
    assert.match(run, /const legacyBrainEnabled = await countEnabledLegacyBrains\(\)\.catch\(\(\) => 0\);/);
    assert.match(run, /formatDigest\(\{[\s\S]*legacyBrainEnabled,\s*\}\)/);
    assert.match(run, /key: "daily_digest",[\s\S]*dedupMs: 20 \* HOUR,/);
    // the count is the only thing read from the brain map
    assert.doesNotMatch(mon, /getAgentBrain|tenant_agent_brain/);
    const lib = src("lib/agent-brain.ts");
    assert.match(lib, /export async function countEnabledLegacyBrains\(\): Promise<number> \{\s*return enabledLegacyBrainCount\(await readMap\(\)\);\s*\}/);
  }

  console.log("agent-brain-retired: all assertions passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
