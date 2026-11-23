// GET / PUT /api/dashboard/agent-brain honour ?asUserId= like the other
// dashboard routes: an admin acts on the TARGET tenant's brain (with the
// admin's powers and the admin's view); a non-admin with a foreign asUserId
// gets 403 and nothing is written; an unknown target gets 404. A tenant's own
// session keeps #415's admin_only rules. Composes the route's own steps
// (resolveScopeUserId's rule, brainScope, brainFromEntry, enabledToSave,
// urlToSave, agentBrainSaveDecision, planAgentBrainEntry, brainView,
// brainActor) over an in-memory brain map; the route's source is asserted to
// match. Mock data only, no network, no DB.
// Run with:  npx tsx scripts/tests/agent-brain-as-user.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { brainFromEntry, planAgentBrainEntry, toWorkerWebhook, type AgentBrain } from "../../lib/agent-brain";
import { agentBrainSaveDecision, brainView, enabledToSave, urlToSave } from "../../lib/agent-brain-guard";
import { brainActor, brainScope, brainTargetNeedsLookup, type ResolvedTarget } from "../../lib/agent-brain-scope";
import { type Resolver } from "../../lib/net/safe-url";

const ROOT = new URL("../../", import.meta.url).pathname;
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

const check = { resolver: (async () => [{ address: "93.184.215.14", family: 4 }]) as Resolver };
const SAFE = "https://agent.example.com/hook";
const OTHER_URL = "https://other.example.com/hook";
const S = "mock-secret-abc";
const quiet = () => {};

const ADMIN = "00000000-0000-0000-0000-00000000a001";
const TENANT = "00000000-0000-0000-0000-00000000b001";
const OTHER_TENANT = "00000000-0000-0000-0000-00000000c001";
const UNKNOWN = "00000000-0000-0000-0000-00000000dead";
const ROLES: Record<string, "admin" | "user"> = { [ADMIN]: "admin", [TENANT]: "user", [OTHER_TENANT]: "user" };

type Entry = Partial<AgentBrain>;
type Map = Record<string, Entry>;

/** resolveTargetUserId (resolveScopeUserId's rule), the DB replaced by ROLES. */
function resolve(sessionUserId: string | null, asUserId: string | null): ResolvedTarget {
  if (!sessionUserId) return { unauthorized: true };
  if (!asUserId || asUserId === sessionUserId) return { userId: sessionUserId, sessionUserId };
  if (ROLES[sessionUserId] !== "admin") return { forbidden: true };
  return { userId: asUserId, sessionUserId };
}

/** The route's scope(): look the target up only when it isn't the caller. */
function scope(caller: string | null, asUserId: string | null) {
  const r = resolve(caller, asUserId);
  const exists = brainTargetNeedsLookup(r) ? r.userId in ROLES : true;
  return brainScope(r, exists);
}

const isAdminOf = (caller: string) => ROLES[caller] === "admin"; // sessionIsAdmin: the CALLER's role

async function routeGet(map: Map, caller: string | null, asUserId: string | null) {
  const s = scope(caller, asUserId);
  if (!s.ok) return { status: s.status, body: s.body as unknown };
  const isAdmin = isAdminOf(caller!);
  return { status: 200, body: { brain: brainView(brainFromEntry(map[s.userId], quiet, {}), isAdmin), urlEditable: isAdmin } as unknown };
}

async function routePut(map: Map, caller: string | null, asUserId: string | null, body: Record<string, unknown>) {
  const logs: Record<string, unknown>[] = [];
  const s = scope(caller, asUserId);
  if (!s.ok) return { status: s.status, body: s.body as unknown, map, logs };
  const isAdmin = isAdminOf(caller!);
  const current = brainFromEntry(map[s.userId], quiet, {});
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
  if (!decision.ok) {
    logs.push({ event: "agent_brain_refused", userId: s.userId, metadata: { error: decision.body.error, ...brainActor(s, isAdmin) } });
    return { status: decision.status, body: decision.body as unknown, map, logs };
  }
  if (decision.noop) return { status: 200, body: null, map, logs };
  const plan = planAgentBrainEntry(
    map[s.userId],
    { enabled: wantsEnabled, url, ...(isAdmin && typeof body.secret === "string" ? { secret: body.secret } : {}) },
    { env: {}, generate: () => "generated-mock" },
  );
  if (!plan.ok) return { status: 400, body: { error: plan.error } as unknown, map, logs };
  const next = { ...map, [s.userId]: plan.entry };
  const b = brainFromEntry(plan.entry, quiet, {});
  logs.push({ event: "agent_brain_updated", userId: s.userId, metadata: { enabled: b.enabled, url: b.url, ...brainActor(s, isAdmin) } });
  return { status: 200, body: null, map: next, logs };
}

async function main() {
  const adminRow: Entry = { enabled: true, url: "https://admin-own.example.com/hook", secret: "admin-mock" };
  const off: Entry = { enabled: false, url: SAFE, secret: S };
  const on: Entry = { enabled: true, url: SAFE, secret: S };
  const base: Map = { [ADMIN]: adminRow, [TENANT]: off, [OTHER_TENANT]: on };

  // ── Scope status codes (what tamaraHenry's screen gets) ─────────────────
  assert.deepEqual(scope(null, null), { ok: false, status: 401, body: { error: "Unauthorized" } });
  assert.deepEqual(scope(null, TENANT), { ok: false, status: 401, body: { error: "Unauthorized" } });
  assert.deepEqual(scope(TENANT, OTHER_TENANT), { ok: false, status: 403, body: { error: "Forbidden" } });
  assert.deepEqual(scope(TENANT, UNKNOWN), { ok: false, status: 403, body: { error: "Forbidden" } }, "non-admin: 403 before any lookup");
  assert.deepEqual(scope(ADMIN, UNKNOWN), { ok: false, status: 404, body: { error: "not_found" } });
  assert.deepEqual(scope(TENANT, TENANT), { ok: true, userId: TENANT, callerId: TENANT }, "own id as asUserId = own session");
  assert.deepEqual(scope(ADMIN, TENANT), { ok: true, userId: TENANT, callerId: ADMIN });
  assert.equal(brainTargetNeedsLookup({ userId: TENANT, sessionUserId: TENANT }), false);

  // ── Gate case 2: an admin via asUserId, a valid write lands on the TARGET ──
  {
    const r = await routePut(base, ADMIN, TENANT, { enabled: true, url: OTHER_URL, secret: "new-mock" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.map[TENANT], { enabled: true, url: OTHER_URL, secret: "new-mock" }, "stored on the target");
    assert.deepEqual(r.map[ADMIN], adminRow, "the admin's own row untouched");
    assert.deepEqual(r.map[OTHER_TENANT], on);
    // the event names the target and that an admin acted; never the secret
    assert.deepEqual(r.logs, [{
      event: "agent_brain_updated", userId: TENANT,
      metadata: { enabled: true, url: OTHER_URL, actedBy: "admin", triggeredBy: ADMIN },
    }]);
    assert.ok(!JSON.stringify(r.logs).includes("new-mock"));
  }
  // each admin power, one at a time, on the target
  assert.deepEqual((await routePut(base, ADMIN, TENANT, { enabled: true })).map[TENANT], on, "switch on");
  assert.deepEqual((await routePut(base, ADMIN, TENANT, { url: OTHER_URL })).map[TENANT], { ...off, url: OTHER_URL }, "set the address");
  assert.deepEqual((await routePut(base, ADMIN, TENANT, { secret: "rotated-mock" })).map[TENANT], { ...off, secret: "rotated-mock" }, "rotate the secret");
  // a first enable with no secret stored generates one, on the target
  {
    const bare: Map = { ...base, [TENANT]: { enabled: false, url: SAFE } };
    const r = await routePut(bare, ADMIN, TENANT, { enabled: true });
    assert.deepEqual(r.map[TENANT], { enabled: true, url: SAFE, secret: "generated-mock" });
    assert.deepEqual(r.map[ADMIN], adminRow);
  }

  // ── Gate case 1: invalid → 400, nothing written (#411/#414 address rules) ──
  for (const [body, error] of [
    [{ enabled: true, url: "http://127.0.0.1/hook" }, "unsafe_url"],
    [{ url: "http://10.0.0.1/hook" }, "unsafe_url"],
  ] as const) {
    const r = await routePut(base, ADMIN, TENANT, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal((r.body as { error: string }).error, error);
    assert.equal(r.map, base, "nothing written");
    assert.deepEqual(r.logs[0]?.metadata, { error, actedBy: "admin", triggeredBy: ADMIN });
  }
  {
    const empty: Map = { ...base, [TENANT]: { enabled: false, url: "" } };
    const r = await routePut(empty, ADMIN, TENANT, { enabled: true });
    assert.deepEqual([r.status, r.body, r.map], [400, { error: "address_required" }, empty]);
  }

  // ── Gate case 4: omitted = unchanged (on the target, admin untouched) ───
  for (const stored of [on, off, { enabled: false, url: "" } as Entry]) {
    const m: Map = { ...base, [TENANT]: stored };
    const r = await routePut(m, ADMIN, TENANT, {});
    assert.equal(r.status, 200);
    assert.deepEqual(r.map[TENANT], stored);
    assert.deepEqual(r.map[ADMIN], adminRow);
  }

  // ── Gate case 3: an unchanged re-send passes ───────────────────────────
  {
    const m: Map = { ...base, [TENANT]: on };
    for (const body of [{ enabled: true }, { enabled: true, url: SAFE, secret: S }, { url: "HTTPS://Agent.Example.COM/hook" }]) {
      const r = await routePut(m, ADMIN, TENANT, body);
      assert.equal(r.status, 200, JSON.stringify(body));
      assert.deepEqual(r.map[TENANT], on, JSON.stringify(body));
      assert.deepEqual(r.map[ADMIN], adminRow);
    }
  }

  // ── A non-admin with a foreign asUserId → 403, nothing written ──────────
  for (const body of [{ enabled: false }, { enabled: true, url: OTHER_URL, secret: "x-mock" }, {}]) {
    const r = await routePut(base, TENANT, OTHER_TENANT, body);
    assert.deepEqual([r.status, r.body, r.map, r.logs], [403, { error: "Forbidden" }, base, []], JSON.stringify(body));
  }
  assert.deepEqual(await routeGet(base, TENANT, OTHER_TENANT), { status: 403, body: { error: "Forbidden" } });

  // ── An unknown target → 404, nothing written ────────────────────────────
  {
    const r = await routePut(base, ADMIN, UNKNOWN, { enabled: true, url: SAFE });
    assert.deepEqual([r.status, r.body, r.map, r.logs], [404, { error: "not_found" }, base, []]);
    assert.ok(!(UNKNOWN in r.map), "no orphan entry");
    assert.deepEqual(await routeGet(base, ADMIN, UNKNOWN), { status: 404, body: { error: "not_found" } });
  }

  // ── A tenant's own session: #415's rules unchanged ──────────────────────
  for (const asUserId of [null, TENANT]) {
    for (const [body, fields] of [
      [{ enabled: true }, ["enabled"]],
      [{ url: OTHER_URL }, ["url"]],
      [{ secret: "new-mock" }, ["secret"]],
    ] as const) {
      const r = await routePut(base, TENANT, asUserId, body);
      assert.deepEqual([r.status, r.body, r.map], [403, { error: "admin_only", fields }, base], `${asUserId} ${JSON.stringify(body)}`);
    }
    const onMap: Map = { ...base, [TENANT]: on };
    const r = await routePut(onMap, TENANT, asUserId, { enabled: false });
    assert.equal(r.status, 200);
    assert.deepEqual(r.map[TENANT], off, "a tenant may switch its own brain off");
    assert.deepEqual(r.logs[0]?.metadata, { enabled: false, url: SAFE, actedBy: "tenant" }, "no triggeredBy on one's own row");
  }
  // an admin on its own row: actedBy admin, no triggeredBy
  {
    const r = await routePut(base, ADMIN, null, { enabled: false });
    assert.deepEqual(r.logs[0]?.metadata, { enabled: false, url: adminRow.url, actedBy: "admin" });
    assert.deepEqual(r.map[TENANT], off);
  }

  // ── GET via asUserId returns the TARGET's state, in the CALLER's view ───
  {
    const m: Map = { ...base, [TENANT]: on };
    const asAdmin = await routeGet(m, ADMIN, TENANT);
    assert.deepEqual(asAdmin, { status: 200, body: { brain: brainView(brainFromEntry(on, quiet, {}), true), urlEditable: true } });
    assert.equal((asAdmin.body as { brain: { url: string } }).brain.url, SAFE, "the target's url, not the admin's");
    const own = await routeGet(m, ADMIN, null);
    assert.equal((own.body as { brain: { url: string } }).brain.url, adminRow.url);
    // a tenant's own GET: today's tenant view (no url, no secret value)
    const t = await routeGet(m, TENANT, null);
    assert.deepEqual(t, { status: 200, body: { brain: { enabled: true, url: "", urlSet: true, secretSet: true }, urlEditable: false } });
  }

  // ── Worker payload per target: unchanged by who wrote it ────────────────
  {
    const r = await routePut(base, ADMIN, TENANT, { enabled: true });
    assert.deepEqual(toWorkerWebhook(brainFromEntry(r.map[TENANT], quiet, {})), { url: SAFE, secret: S });
    assert.deepEqual(toWorkerWebhook(brainFromEntry(r.map[ADMIN], quiet, {})), toWorkerWebhook(brainFromEntry(adminRow, quiet, {})));
  }

  // ── Source guard: the route reads and writes the resolved target only ──
  {
    const route = src("app/api/dashboard/agent-brain/route.ts");
    assert.doesNotMatch(route, /session\.user\.id/, "no handler uses session.user.id");
    assert.doesNotMatch(route, /\bauth\(\)/, "the scope comes from resolveTargetUserId only");
    assert.match(route, /const r = await resolveTargetUserId\(req\);/);
    assert.match(route, /if \(brainTargetNeedsLookup\(r\)\) \{\s*const \[u\] = await db\.select\(\{ id: users\.id \}\)\.from\(users\)\.where\(eq\(users\.id, r\.userId\)\)\.limit\(1\);\s*targetExists = Boolean\(u\);\s*\}\s*return brainScope\(r, targetExists\);/);
    for (const h of ["GET", "PUT"]) {
      const body = route.slice(route.indexOf(`export async function ${h}(req: NextRequest)`));
      assert.ok(route.includes(`export async function ${h}(req: NextRequest)`), h);
      assert.match(body, /^export async function \w+\(req: NextRequest\) \{\s*const s = await scope\(req\);\s*if \(!s\.ok\) return NextResponse\.json\(s\.body, \{ status: s\.status \}\);/, `${h}: scoped first`);
    }
    // every store call goes to the target; isAdmin is the CALLER's role
    const calls = route.match(/(?:getAgentBrain|setAgentBrain)\(([^,)]*)/g) ?? [];
    assert.equal(calls.length, 3);
    for (const c of calls) assert.match(c, /\(s\.userId$/, c);
    assert.equal((route.match(/sessionIsAdmin\(\)/g) ?? []).length, 2);
    // both events carry the target + the actor
    assert.equal((route.match(/userId: s\.userId,/g) ?? []).length, 2);
    assert.equal((route.match(/\.\.\.brainActor\(s, isAdmin\)/g) ?? []).length, 2);
    // resolveScopeUserId's rule as modelled above
    const imp = src("lib/admin-impersonate.ts");
    assert.match(imp, /if \(!opts\.asUserId \|\| opts\.asUserId === opts\.sessionUserId\) \{\s*return \{ userId: opts\.sessionUserId \};/);
    assert.match(imp, /if \(me\?\.role !== "admin"\) return \{ forbidden: true \};\s*return \{ userId: opts\.asUserId \};/);
    assert.match(src("lib/api/auth-guards.ts"), /return \{ userId: scope\.userId, sessionUserId: session\.user\.id \};/);
  }

  console.log("ALL AGENT-BRAIN-AS-USER TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
