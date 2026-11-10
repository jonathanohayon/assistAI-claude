// A `tools` write (T3). Receptionist: the CRM tile toggles and the transfer
// columns — the calls' read source — are written in the SAME transaction.
// Outbound: stored only (inactive until T4).
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs, outboundAgents } from "@/lib/db/schema";
import { getTileToggles, setTileTogglesIn } from "@/lib/tile-toggles";
import { planOutboundToolsWrite, planReceptionistToolsWrite } from "@/lib/tools/store";

export type ToolsWriteResult = { ok: true } | { ok: false; status: 400 | 404; body: { error: string; fields?: string[] } };

// ::jsonb cast: postgres-js would serialise the object as text otherwise.
const jsonb = (v: unknown) => sql`${JSON.stringify(v)}::jsonb`;

export async function writeTools(userId: string, agentId: string | null, patch: unknown): Promise<ToolsWriteResult> {
  if (agentId) {
    const where = and(eq(outboundAgents.id, agentId), eq(outboundAgents.userId, userId));
    const [row] = await db.select({ toolsConfig: outboundAgents.toolsConfig }).from(outboundAgents).where(where).limit(1);
    if (!row) return { ok: false, status: 404, body: { error: "not_found" } };
    const plan = planOutboundToolsWrite(row.toolsConfig, patch);
    if (!plan.ok) return { ok: false, status: 400, body: { error: "invalid_tools", fields: plan.errors } };
    await db.update(outboundAgents).set({ toolsConfig: jsonb(plan.value), updatedAt: new Date() } as never).where(where);
    return { ok: true };
  }
  return db.transaction(async (tx): Promise<ToolsWriteResult> => {
    // Row locked: two concurrent saves can't interleave toggles and columns.
    const [row] = await tx
      .select({
        toolsConfig: agentConfigs.toolsConfig,
        transferNumber: agentConfigs.transferNumber,
        transferNumberParked: agentConfigs.transferNumberParked,
      })
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, userId))
      .for("update");
    if (!row) return { ok: false, status: 404, body: { error: "not_found" } };
    const plan = planReceptionistToolsWrite(row, await getTileToggles(userId), patch);
    if (!plan.ok) return { ok: false, status: 400, body: { error: plan.error, fields: plan.fields } };
    await setTileTogglesIn(tx, userId, plan.toggles);
    await tx
      .update(agentConfigs)
      .set({
        toolsConfig: jsonb(plan.columns.toolsConfig),
        transferNumber: plan.columns.transferNumber,
        transferNumberParked: plan.columns.transferNumberParked,
        updatedAt: new Date(),
      } as never)
      .where(eq(agentConfigs.userId, userId));
    return { ok: true };
  });
}
