// Keeps stored `tools` in step when a LEGACY setting is written (T3):
// a transfer number saved from the config forms, or a CRM tile toggle.
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs } from "@/lib/db/schema";
import { getTileToggles, setTileTogglesIn, type TileToggles } from "@/lib/tile-toggles";
import { columnsAfterLegacyTransferWrite, currentReceptionistTools } from "@/lib/tools/store";

const jsonb = (v: unknown) => sql`${JSON.stringify(v)}::jsonb`;

/**
 * Extra agent_configs updates for a legacy transferNumber write: nothing
 * stays parked, and a stored `tools` is refreshed. {} when the value is the
 * one already served (an OFF transfer switch stays OFF).
 */
export async function legacyTransferWriteUpdates(userId: string, transferNumber: string) {
  const [row] = await db
    .select({
      toolsConfig: agentConfigs.toolsConfig,
      transferNumber: agentConfigs.transferNumber,
      transferNumberParked: agentConfigs.transferNumberParked,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId))
    .limit(1);
  if (!row) return {};
  const next = columnsAfterLegacyTransferWrite(row, await getTileToggles(userId), transferNumber);
  if (!next) return {};
  return {
    transferNumberParked: null,
    // NULL stays NULL (derived on read); a stored value is refreshed.
    ...(row.toolsConfig == null ? {} : { toolsConfig: jsonb(next.toolsConfig) }),
  };
}

/** A legacy tile-toggles write, plus a stored `tools` refresh, in one transaction. */
export async function setTileTogglesSyncingTools(userId: string, patch: Partial<TileToggles>): Promise<TileToggles> {
  return db.transaction(async (tx) => {
    const toggles = await setTileTogglesIn(tx, userId, patch);
    const [row] = await tx
      .select({
        toolsConfig: agentConfigs.toolsConfig,
        transferNumber: agentConfigs.transferNumber,
        transferNumberParked: agentConfigs.transferNumberParked,
      })
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, userId))
      .for("update");
    if (row && row.toolsConfig != null) {
      await tx
        .update(agentConfigs)
        .set({ toolsConfig: jsonb(currentReceptionistTools(row, toggles)) } as never)
        .where(eq(agentConfigs.userId, userId));
    }
    return toggles;
  });
}
