// POST /api/dashboard/subscription/schedule-change through the REAL route
// handler against a THROWAWAY Postgres. Only the session is a test double
// (scripts/tests/fixtures/schedule-change/hooks.mjs).
//
// Permanent within-tree invariants: every case starts from the same seed and
// must return its hard-coded status + body, leave exactly the expected users
// rows and log exactly the expected events. No comparison with another tree
// (origin/main or any ref): the expectations below ARE the spec.
// Run with:  bash scripts/schedule-change-db.sh
// Skipped in a plain `npm test`. Mock data only (example.test).

import assert from "node:assert/strict";

const url = process.env.SCHED_DB_URL;
if (!url) {
  console.log("SKIPPED schedule-change-db (run bash scripts/schedule-change-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (!(globalThis as { __schedHooks?: boolean }).__schedHooks) throw new Error("module hooks missing: run through scripts/schedule-change-db.sh");
process.env.DATABASE_URL = url;

const g = globalThis as { __schedSession?: { user: { id: string } } | null };
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const PREMIUM = id(0x1); // premium, monthly, a downgrade to global already scheduled
const GLOBAL = id(0x2); // global, annual, nothing scheduled
const LEGACY = id(0x3); // grandfathered on the non-public "whatsapp" plan
const PAID_UNTIL = "2031-01-15T10:00:00.000Z";
// Differs from PAID_UNTIL so a newly stored downgrade (effective at paid_until)
// is visibly different from the prior one.
const PRIOR_AT = "2030-06-01T08:00:00.000Z";

type Row = {
  id: string;
  subscription_plan: string;
  subscription_period: string;
  scheduled_plan: string | null;
  scheduled_plan_period: string | null;
  scheduled_plan_at: string | null;
};
const SEEDED: Row[] = [
  { id: PREMIUM, subscription_plan: "premium", subscription_period: "monthly", scheduled_plan: "global", scheduled_plan_period: "monthly", scheduled_plan_at: PRIOR_AT },
  { id: GLOBAL, subscription_plan: "global", subscription_period: "annual", scheduled_plan: null, scheduled_plan_period: null, scheduled_plan_at: null },
  { id: LEGACY, subscription_plan: "whatsapp", subscription_period: "monthly", scheduled_plan: "whatsapp", scheduled_plan_period: "monthly", scheduled_plan_at: PRIOR_AT },
];
/** The seed with one user's row patched. */
const seededWith = (who: string, patch: Partial<Row>): Row[] =>
  SEEDED.map((r) => (r.id === who ? { ...r, ...patch } : r));
const CLEARED = { scheduled_plan: null, scheduled_plan_period: null, scheduled_plan_at: null };

type Case = {
  name: string;
  user: string | null;
  body: unknown;
  status: number;
  response: unknown;
  after: Row[];
  events: string[];
};

const unchanged = (status: number, error: string) => ({
  status,
  response: { error },
  after: SEEDED,
  events: [] as string[],
});

const CASES: Case[] = [
  {
    name: "public downgrade premium → global is stored at paid_until",
    user: PREMIUM,
    body: { plan: "global" },
    status: 200,
    response: { ok: true, scheduledPlan: "global", effectiveAt: PAID_UNTIL },
    after: seededWith(PREMIUM, { scheduled_plan: "global", scheduled_plan_period: "monthly", scheduled_plan_at: PAID_UNTIL }),
    events: ["subscription_downgrade_scheduled"],
  },
  {
    name: "public downgrade with explicit annual period stores the period",
    user: PREMIUM,
    body: { plan: "global", period: "annual" },
    status: 200,
    response: { ok: true, scheduledPlan: "global", effectiveAt: PAID_UNTIL },
    after: seededWith(PREMIUM, { scheduled_plan: "global", scheduled_plan_period: "annual", scheduled_plan_at: PAID_UNTIL }),
    events: ["subscription_downgrade_scheduled"],
  },
  { name: "non-public downgrade premium → whatsapp is plan_not_available, nothing written", user: PREMIUM, body: { plan: "whatsapp" }, ...unchanged(400, "plan_not_available") },
  { name: "non-public downgrade global → whatsapp is plan_not_available, nothing written", user: GLOBAL, body: { plan: "whatsapp" }, ...unchanged(400, "plan_not_available") },
  { name: "upgrade global → premium is upgrade_requires_payment", user: GLOBAL, body: { plan: "premium" }, ...unchanged(400, "upgrade_requires_payment") },
  { name: "upgrade legacy whatsapp → premium is upgrade_requires_payment", user: LEGACY, body: { plan: "premium" }, ...unchanged(400, "upgrade_requires_payment") },
  {
    name: "plan == current (premium) clears the scheduled change, no event",
    user: PREMIUM,
    body: { plan: "premium" },
    status: 200,
    response: { ok: true, cleared: true },
    after: seededWith(PREMIUM, CLEARED),
    events: [],
  },
  {
    name: "plan == current grandfathered whatsapp clears the scheduled change, no event",
    user: LEGACY,
    body: { plan: "whatsapp" },
    status: 200,
    response: { ok: true, cleared: true },
    after: seededWith(LEGACY, CLEARED),
    events: [],
  },
  ...[
    { name: "plan null clears", body: { plan: null } as unknown },
    { name: "omitted plan clears", body: {} },
    { name: "non-JSON body clears", body: "not json" },
  ].map((c) => ({
    ...c,
    user: PREMIUM,
    status: 200,
    response: { ok: true, cleared: true },
    after: seededWith(PREMIUM, CLEARED),
    events: ["subscription_schedule_cleared"],
  })),
  { name: "unknown plan key is invalid_plan", user: PREMIUM, body: { plan: "enterprise" }, ...unchanged(400, "invalid_plan") },
  { name: "signed out is 401", user: null, body: { plan: "global" }, ...unchanged(401, "unauthorized") },
];

async function main() {
  assert.equal(CASES.length, 13);
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
    JSON.parse(JSON.stringify(await rows(sql`SELECT id, subscription_plan, subscription_period,
        scheduled_plan, scheduled_plan_period,
        to_char(scheduled_plan_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS scheduled_plan_at
      FROM users ORDER BY id`)));
  const eventNames = async () =>
    (await rows(sql`SELECT event FROM events ORDER BY created_at, event`)).map((r) => r.event);

  for (const c of CASES) {
    await seed();
    assert.deepEqual(await state(), SEEDED, `${c.name}: seed`);
    g.__schedSession = c.user ? { user: { id: c.user } } : null;
    const res = await route.POST(
      new NextRequest("http://localhost/api/dashboard/subscription/schedule-change", {
        method: "POST",
        body: typeof c.body === "string" ? c.body : JSON.stringify(c.body),
        headers: { "content-type": "application/json" },
      }),
    );
    const text = await res.text();
    assert.equal(res.status, c.status, `${c.name}: status`);
    assert.deepEqual(text ? JSON.parse(text) : null, c.response, `${c.name}: body`);
    assert.deepEqual(await state(), c.after, `${c.name}: users rows`);
    assert.deepEqual(await eventNames(), c.events, `${c.name}: events`);
    console.log(`ok  ${c.name} (${c.status} ${JSON.stringify(c.response)})`);
  }
  console.log(`\nschedule-change-db: ${CASES.length} cases passed`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
