// PATCH /api/dashboard/outbound-agents/[id] returns the stored mission: the
// route's own queries (update … returning(), then the GET's select) against a
// real Postgres, built into JSON the way the route builds it. Mock data only.
// Run with:  MISSION_PATCH_TEST_DB_URL=<throwaway db> npx tsx scripts/tests/mission-patch-response-db.test.ts
// Runs only when MISSION_PATCH_TEST_DB_URL points at a THROWAWAY, migrated
// database (it inserts and deletes rows); otherwise it is skipped, so plain
// `npm test` never touches a database. The handlers themselves are not called:
// they need a next-auth session.

import assert from "node:assert/strict";

const url = process.env.MISSION_PATCH_TEST_DB_URL;
if (!url) {
  console.log("SKIPPED mission-patch-response-db (set MISSION_PATCH_TEST_DB_URL to a throwaway Postgres)");
  process.exit(0);
}
process.env.DATABASE_URL = url;

async function main() {
  const { and, eq, sql } = await import("drizzle-orm");
  const { db } = await import("../../lib/db");
  const { outboundAgents, users } = await import("../../lib/db/schema");
  const { currentAgentMission, withoutMissionStore } = await import("../../lib/mission/store");
  const { withoutToolsStore } = await import("../../lib/tools/store");
  const { planOutboundAgentPatch } = await import("../../lib/outbound-agents/patch");
  type Row = typeof outboundAgents.$inferSelect;

  const U = "00000000-0000-4000-8000-00000000000a";
  const A = "00000000-0000-4000-8000-0000000000c3";
  await db.delete(users).where(eq(users.id, U)); // cascades to outbound_agents
  await db.insert(users).values({ id: U, email: "mission-patch@example.test", passwordHash: "x" });
  await db.insert(outboundAgents).values({ id: A, userId: U, name: "Vente Mock", agentName: "Noam", instructions: "Consignes mock." });

  // Same shapes as the route (mission key only; the rest is covered elsewhere).
  const json = (r: Row) => JSON.parse(JSON.stringify({ ...withoutMissionStore(withoutToolsStore(r)), mission: currentAgentMission(r.mission) }));
  const loadOwned = async () =>
    (await db.select().from(outboundAgents).where(and(eq(outboundAgents.id, A), eq(outboundAgents.userId, U))).limit(1))[0];

  const steps: Array<[Record<string, unknown>, unknown]> = [
    [{ mission: { kind: "qualify_lead", cold: true } }, { version: 1, kind: "qualify_lead", cold: true }],
    [{ agentName: "Dana" }, { version: 1, kind: "qualify_lead", cold: true }],
    [{ mission: { kind: "follow_up" } }, { version: 1, kind: "follow_up", cold: false }],
    [{ mission: null }, null],
    [{ greeting: "Bonjour {{name}}" }, null],
  ];
  for (const isAdmin of [false, true]) {
    for (const [body, want] of steps) {
      const agent = await loadOwned();
      const plan = planOutboundAgentPatch(body, agent, isAdmin);
      assert.ok("set" in plan, JSON.stringify(plan));
      const [updated] = await db.update(outboundAgents).set({ ...plan.set, updatedAt: sql`now()` }).where(eq(outboundAgents.id, agent.id)).returning();
      const patchRes = json(updated);
      const getRes = json(await loadOwned());
      assert.deepEqual(patchRes.mission, want, `PATCH ${JSON.stringify(body)} → mission ${JSON.stringify(want)}`);
      assert.deepEqual(patchRes.mission, getRes.mission, "PATCH response mission === following GET mission");
      assert.equal("toolsConfig" in patchRes, false);
      console.log(`  ok ${isAdmin ? "admin" : "tenant"} PATCH ${JSON.stringify(body)} → ${JSON.stringify(patchRes.mission)}`);
    }
  }
  await db.delete(users).where(eq(users.id, U));
  console.log("ALL MISSION PATCH RESPONSE DB TESTS PASSED");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
