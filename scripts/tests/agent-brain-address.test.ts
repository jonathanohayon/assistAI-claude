// Enabling the own-agent brain without a usable address is REFUSED, never
// silently stored as enabled:false with a 200.
//   - empty / whitespace address + enabled:true → 400 address_required (no
//     message), checked BEFORE the SSRF check;
//   - a non-empty address that can't be used → 400 unsafe_url, as today,
//     including one the SSRF check accepts but the store rule doesn't
//     ("HTTPS://…", the one input that still reached the old downgrade);
//   - turning OFF never needs an address.
// Composes the route's own helpers (urlToSave, enabledToSave,
// agentBrainSaveDecision, planAgentBrainEntry) as PUT
// /api/dashboard/agent-brain does. Mock data only, no network, no DB.
// Run with:  npx tsx scripts/tests/agent-brain-address.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { brainFromEntry, planAgentBrainEntry, toWorkerWebhook, type AgentBrain } from "../../lib/agent-brain";
import { agentBrainSaveDecision, brainAddressUsable, enabledToSave, urlToSave } from "../../lib/agent-brain-guard";
import { SAFE_URL_MESSAGE, type Resolver } from "../../lib/net/safe-url";

const ROOT = new URL("../../", import.meta.url).pathname;
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

const check = { resolver: (async () => [{ address: "93.184.215.14", family: 4 }]) as Resolver };
const SAFE = "https://agent.example.com/hook";
const UPPER = "HTTPS://agent.example.com/hook";
const TENANT_AND_ADMIN = [false, true] as const;
const who = (isAdmin: boolean) => (isAdmin ? "admin" : "tenant");
const quiet = () => {};

type Stored = { enabled: boolean; url: string; secret?: string };

/** The route's PUT, I/O removed: body + stored row → the stored row after the PUT, or the refusal. */
async function brainPut(body: Record<string, unknown>, current: Stored, isAdmin: boolean, generate = () => "generated-mock") {
  const wantsEnabled = enabledToSave(body.enabled, current.enabled);
  const url = urlToSave(body.url, current.url, isAdmin);
  const decision = await agentBrainSaveDecision({ currentUrl: current.url, url, wantsEnabled, isAdmin, check });
  if (!decision.ok) return { status: decision.status, body: decision.body, stored: current };
  const plan = planAgentBrainEntry(
    current,
    { enabled: wantsEnabled, url, ...(typeof body.secret === "string" ? { secret: body.secret } : {}) },
    { env: {}, generate },
  );
  if (!plan.ok) return { status: 400, body: { error: plan.error }, stored: current };
  return { status: 200, body: null, stored: plan.entry as Stored };
}

async function main() {
  // ── The case that differs from main: empty address + enabled:true ─────
  // main: 400 unsafe_url (the SSRF check ran first). Branch: address_required.
  for (const url of ["", "   "]) {
    assert.deepEqual(
      await agentBrainSaveDecision({ currentUrl: "", url, wantsEnabled: true, isAdmin: true, check }),
      { ok: false, status: 400, body: { error: "address_required" } },
      `enabled:true with url ${JSON.stringify(url)} → address_required`,
    );
  }
  // main: ok (then the store silently stored enabled:false, 200). Branch: unsafe_url.
  assert.deepEqual(
    await agentBrainSaveDecision({ currentUrl: "", url: UPPER, wantsEnabled: true, isAdmin: true, check }),
    { ok: false, status: 400, body: { error: "unsafe_url", message: SAFE_URL_MESSAGE } },
    "an upper-case HTTPS:// scheme passes the SSRF check but can't be stored enabled → unsafe_url",
  );

  // ── brainAddressUsable: the store's rule, unchanged (trimmed, starts with "http") ──
  for (const u of [SAFE, "http://x", "  https://x  ", "httpfoo"]) assert.equal(brainAddressUsable(u), true, u);
  for (const u of ["", "   ", "ftp://x", "agent.example.com", UPPER, "Https://x"]) assert.equal(brainAddressUsable(u), false, u);

  // ── Gate case 1: forbidden ────────────────────────────────────────────
  {
    const route = src("app/api/dashboard/agent-brain/route.ts");
    // anon → 401 before anything is read or written (both handlers)
    const put = route.slice(route.indexOf("export async function PUT"));
    assert.ok(put.indexOf('{ error: "Unauthorized" }, { status: 401 }') < put.indexOf("setAgentBrain("), "PUT: 401 before the write");
    // the route composes exactly the helpers this file composes
    assert.match(put, /const wantsEnabled = enabledToSave\(body\.enabled, current\.enabled\);/);
    assert.match(put, /const url = urlToSave\(body\.url, current\.url, isAdmin\);/);
    assert.match(put, /agentBrainSaveDecision\(\{ currentUrl: current\.url, url, wantsEnabled, isAdmin \}\)/);
    assert.match(put, /if \(e instanceof AgentBrainAddressRequiredError\) \{\s*return NextResponse\.json\(\{ error: "address_required" \}, \{ status: 400 \}\);/);
    const lib = src("lib/agent-brain.ts");
    assert.match(lib, /const plan = planAgentBrainEntry\(map\[userId\], next\);\s*if \(!plan\.ok\) throw new AgentBrainAddressRequiredError\(\);/);
    // a tenant can't change the url (even to a missing one is not possible: "" keeps it)
    const cur: Stored = { enabled: false, url: SAFE, secret: "mock-secret" };
    const r = await brainPut({ enabled: true, url: "https://other.example.com/hook" }, cur, false);
    assert.deepEqual(r, { status: 403, body: { error: "admin_only", fields: ["url"] }, stored: cur });
  }

  // ── Gate case 2: a valid write is stored ──────────────────────────────
  for (const isAdmin of TENANT_AND_ADMIN) {
    const cur: Stored = { enabled: false, url: SAFE };
    const r = await brainPut({ enabled: true }, cur, isAdmin);
    assert.deepEqual(r, { status: 200, body: null, stored: { enabled: true, url: SAFE, secret: "generated-mock" } }, `${who(isAdmin)}: enabling with a stored url`);
  }
  assert.deepEqual(await brainPut({ enabled: true, url: ` ${SAFE} ` }, { enabled: false, url: "" }, true), {
    status: 200, body: null, stored: { enabled: true, url: SAFE, secret: "generated-mock" },
  });

  // ── Gate case 3: invalid → 400, stored row unchanged, no secret generated ──
  for (const isAdmin of TENANT_AND_ADMIN) {
    for (const cur of [
      { enabled: false, url: "" },
      { enabled: false, url: "", secret: "mock-secret" },
    ] as Stored[]) {
      let generated = 0;
      const gen = () => (generated++, "generated-mock");
      for (const body of [{ enabled: true }, { enabled: true, url: "" }, { enabled: true, url: "   " }, { enabled: true, secret: "new-mock" }]) {
        const r = await brainPut(body, cur, isAdmin, gen);
        assert.deepEqual(r, { status: 400, body: { error: "address_required" }, stored: cur }, `${who(isAdmin)} ${JSON.stringify(body)} on ${JSON.stringify(cur)}`);
      }
      assert.equal(generated, 0, "no secret generated on a refusal");
    }
  }
  // admin: a non-empty unusable address keeps answering unsafe_url (unchanged)
  for (const url of ["ftp://agent.example.com/hook", "http://agent.example.com/hook", "https://127.0.0.1/hook", "agent.example.com", UPPER]) {
    const cur: Stored = { enabled: false, url: "" };
    const r = await brainPut({ enabled: true, url }, cur, true);
    assert.deepEqual(r, { status: 400, body: { error: "unsafe_url", message: SAFE_URL_MESSAGE }, stored: cur }, url);
  }

  // ── Gate case 4: omitted fields keep the stored value ─────────────────
  for (const isAdmin of TENANT_AND_ADMIN) {
    const on: Stored = { enabled: true, url: SAFE, secret: "mock-secret" };
    // omitted url → the stored one; omitted secret → kept
    assert.deepEqual((await brainPut({ enabled: true }, on, isAdmin)).stored, on);
    // omitted enabled → the stored value (true here, so a url-less row is still refused)
    assert.deepEqual((await brainPut({ secret: "x" }, on, isAdmin)).stored, { ...on, secret: "x" });
    // omitted enabled on an OFF row with no url: stays off, passes
    const off: Stored = { enabled: false, url: "" };
    assert.deepEqual(await brainPut({ secret: "x" }, off, isAdmin), { status: 200, body: null, stored: { ...off, secret: "x" } });
  }
  // admin clears the url without sending enabled on an ON row → refused, nothing written
  {
    const on: Stored = { enabled: true, url: SAFE, secret: "mock-secret" };
    assert.deepEqual(await brainPut({ url: "" }, on, true), { status: 400, body: { error: "address_required" }, stored: on });
    // and an admin's url-only change to the upper-case form → unsafe_url (was: silently switched off)
    assert.deepEqual(await brainPut({ url: UPPER }, on, true), { status: 400, body: { error: "unsafe_url", message: SAFE_URL_MESSAGE }, stored: on });
  }

  // ── Turning OFF never needs an address ────────────────────────────────
  for (const isAdmin of TENANT_AND_ADMIN) {
    for (const cur of [{ enabled: true, url: SAFE, secret: "mock-secret" }, { enabled: false, url: "" }] as Stored[]) {
      const r = await brainPut({ enabled: false }, cur, isAdmin);
      assert.equal(r.status, 200, `${who(isAdmin)}: off`);
      assert.deepEqual(r.stored, { ...cur, enabled: false });
    }
  }
  assert.deepEqual(await brainPut({ enabled: false, url: "" }, { enabled: true, url: SAFE }, true), { status: 200, body: null, stored: { enabled: false, url: "" } });
  assert.deepEqual(await brainPut({ enabled: false, url: "ftp://x" }, { enabled: false, url: "" }, true), {
    status: 400, body: { error: "unsafe_url", message: SAFE_URL_MESSAGE }, stored: { enabled: false, url: "" },
  }, "saving an unsafe url stays refused while off (unchanged)");

  // ── The store itself: never a silent downgrade ────────────────────────
  for (const url of ["", "  ", "ftp://x", UPPER, "agent.example.com", SAFE, "http://x"]) {
    for (const enabled of [true, false]) {
      const plan = planAgentBrainEntry(undefined, { enabled, url }, { env: {}, generate: () => "g" });
      if (enabled && !brainAddressUsable(url)) assert.deepEqual(plan, { ok: false, error: "address_required" }, url);
      else {
        assert.ok(plan.ok, url);
        assert.equal(plan.entry.enabled, enabled, `asked ${enabled}, stored ${enabled} (${url})`);
        assert.equal(plan.entry.url, url.trim());
      }
    }
  }

  // ── Worker payload: toWorkerWebhook for every stored state, unchanged ──
  const served = (e: Partial<AgentBrain>) => toWorkerWebhook(brainFromEntry(e, quiet, {}));
  assert.deepEqual(served({ enabled: true, url: SAFE, secret: "s" }), { url: SAFE, secret: "s" });
  assert.deepEqual(served({ enabled: true, url: SAFE }), { url: SAFE });
  assert.equal(served({ enabled: false, url: SAFE, secret: "s" }), undefined);
  assert.equal(served({ enabled: true, url: "" }), undefined);
  assert.equal(served({ enabled: true, url: "ftp://x" }), undefined);
  assert.equal(served({}), undefined);
  // every row the store accepts serves exactly what it says (on → served, off → not)
  for (const enabled of [true, false]) {
    const plan = planAgentBrainEntry(undefined, { enabled, url: SAFE }, { env: {}, generate: () => "g" });
    assert.ok(plan.ok);
    assert.deepEqual(served(plan.entry), enabled ? { url: SAFE, secret: "g" } : undefined);
  }

  console.log("ALL AGENT-BRAIN-ADDRESS TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
