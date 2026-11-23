// POST /api/dashboard/subscription/schedule-change through the REAL route
// handler against a THROWAWAY Postgres. Only the session is a test double
// (scripts/tests/fixtures/schedule-change/hooks.mjs).
//
//   SCHED_PHASE=main   → run every case on origin/main's tree, write a snapshot
//   SCHED_PHASE=branch → every case byte-identical to the snapshot, except a
//                        downgrade to a non-public plan: 400 plan_not_available
//                        and nothing written.
// Run with:  bash scripts/schedule-change-db.sh
// Skipped in a plain `npm test`. Mock data only (example.test).

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const url = process.env.SCHED_DB_URL;
if (!url) {
  console.log("SKIPPED schedule-change-db (run bash scripts/schedule-change-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (!(globalThis as { __schedHooks?: boolean }).__schedHooks) throw new Error("module hooks missing: run through scripts/schedule-change-db.sh");
process.env.DATABASE_URL = url;
const PHASE = process.env.SCHED_PHASE;
const SNAP = process.env.SCHED_SNAPSHOT!;

const g = globalThis as { __schedSession?: { user: { id: string } } | null };
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const PREMIUM = id(0x1); // premium, monthly
const GLOBAL = id(0x2); // global, annual
const LEGACY = id(0x3); // grandfathered on the non-public "whatsapp" plan
const PAID_UNTIL = "2031-01-15T10:00:00.000Z";
const PRIOR_AT = "2031-01-15T10:00:00.000Z";

type Case = { name: string; user: string | null; body: unknown };

// Every case starts from a fresh seed. "prior" = a downgrade already scheduled,
// so a refusal visibly leaves it in place and a clear visibly removes it.
const CASES: Case[] = [
  { name: "public downgrade premium → global is stored", user: PREMIUM, body: { plan: "global" } },
  { name: "public downgrade with explicit annual period", user: PREMIUM, body: { plan: "global", period: "annual" } },
  { name: "non-public downgrade premium → whatsapp", user: PREMIUM, body: { plan: "whatsapp" } },
  { name: "non-public downgrade global → whatsapp", user: GLOBAL, body: { plan: "whatsapp" } },
  { name: "upgrade global → premium is refused", user: GLOBAL, body: { plan: "premium" } },
  { name: "upgrade legacy whatsapp → premium is refused", user: LEGACY, body: { plan: "premium" } },
  { name: "plan == current (premium) clears the scheduled change", user: PREMIUM, body: { plan: "premium" } },
  { name: "plan == current grandfathered whatsapp clears the scheduled change", user: LEGACY, body: { plan: "whatsapp" } },
  { name: "plan null clears", user: PREMIUM, body: { plan: null } },
  { name: "omitted plan clears", user: PREMIUM, body: {} },
  { name: "non-JSON body clears", user: PREMIUM, body: "not json" },
  { name: "unknown plan key is invalid_plan", user: PREMIUM, body: { plan: "enterprise" } },
  { name: "signed out is 401", user: null, body: { plan: "global" } },
];
const CHANGED_BY_BRANCH = new Set([
  "non-public downgrade premium → whatsapp",
  "non-public downgrade global → whatsapp",
]);

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const route = await import("../../app/api/dashboard/subscription/schedule-change/route");
  const exec = (q: ReturnType<typeof sql>) => db.execute(q);
  const rows = async (q: ReturnType<typeof sql>) => {
    const r = (await exec(q)) as unknown as unknown[] | { rows: unknown[] };
    return (Array.isArray(r) ? r : r.rows) as Record<string, unknown>[];
  };

  async function seed() {
    await exec(sql`DELETE FROM events`);
    await exec(sql`DELETE FROM users`);
    await exec(sql`INSERT INTO users (id, email, password_hash, role, subscription_plan, subscription_period, paid_until,
        scheduled_plan, scheduled_plan_period, scheduled_plan_at) VALUES
      (${PREMIUM}, 'premium@example.test', 'x', 'user', 'premium', 'monthly', ${PAID_UNTIL}, 'global', 'monthly', ${PRIOR_AT}),
      (${GLOBAL}, 'global@example.test', 'x', 'user', 'global', 'annual', ${PAID_UNTIL}, NULL, NULL, NULL),
      (${LEGACY}, 'legacy@example.test', 'x', 'user', 'whatsapp', 'monthly', ${PAID_UNTIL}, 'whatsapp', 'monthly', ${PRIOR_AT})`);
  }

  const state = async () =>
    rows(sql`SELECT id, subscription_plan, subscription_period,
        scheduled_plan, scheduled_plan_period,
        to_char(scheduled_plan_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS scheduled_plan_at
      FROM users ORDER BY id`);
  const eventNames = async () =>
    (await rows(sql`SELECT event FROM events ORDER BY created_at, event`)).map((r) => r.event);

  const results: Record<string, unknown> = {};
  for (const c of CASES) {
    await seed();
    g.__schedSession = c.user ? { user: { id: c.user } } : null;
    const before = await state();
    const res = await route.POST(
      new NextRequest("http://localhost/api/dashboard/subscription/schedule-change", {
        method: "POST",
        body: typeof c.body === "string" ? c.body : JSON.stringify(c.body),
        headers: { "content-type": "application/json" },
      }),
    );
    const text = await res.text();
    results[c.name] = JSON.parse(JSON.stringify({
      status: res.status,
      body: text ? JSON.parse(text) : null,
      before,
      after: await state(),
      events: await eventNames(),
    }));
  }

  if (PHASE === "main") {
    writeFileSync(SNAP, JSON.stringify(results, null, 2));
    console.log(`main snapshot written: ${CASES.length} cases`);
    return;
  }
  assert.equal(PHASE, "branch");
  const main = JSON.parse(readFileSync(SNAP, "utf8")) as Record<string, unknown>;
  type R = { status: number; body: Record<string, unknown>; before: unknown; after: unknown; events: unknown[] };

  for (const c of CASES) {
    const r = results[c.name] as R;
    if (!CHANGED_BY_BRANCH.has(c.name)) {
      assert.deepEqual(r, main[c.name], `${c.name}: must be byte-identical to origin/main`);
      console.log(`ok  ${c.name} (identical to main: ${r.status})`);
      continue;
    }
    // On main the non-public plan WAS scheduled (the bug); on the branch it is refused.
    const m = main[c.name] as R;
    assert.equal(m.status, 200, `${c.name}: main accepted it (the bug this fixes)`);
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: "plan_not_available" });
    assert.deepEqual(r.after, r.before, `${c.name}: nothing written`);
    assert.deepEqual(r.events, [], `${c.name}: no event logged`);
    console.log(`ok  ${c.name} (main 200 stored → branch 400 plan_not_available, unchanged)`);
  }

  // Spot-check the shapes the identical cases pin down.
  const pub = results["public downgrade premium → global is stored"] as R;
  assert.equal(pub.status, 200);
  assert.equal(pub.body.scheduledPlan, "global");
  const up = results["upgrade global → premium is refused"] as R;
  assert.deepEqual([up.status, up.body], [400, { error: "upgrade_requires_payment" }]);
  const same = results["plan == current grandfathered whatsapp clears the scheduled change"] as R;
  assert.deepEqual([same.status, same.body], [200, { ok: true, cleared: true }]);
  console.log(`\nschedule-change-db: ${CASES.length} cases passed`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
