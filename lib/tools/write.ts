// A `tools` write (T3). Receptionist: the CRM tile toggles and the transfer
// columns — the calls' read source — are written in the SAME transaction.
// Outbound: stored only (inactive until T4).
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs, outboundAgents } from "@/lib/db/schema";
import { checkAgentUrl, SAFE_URL_MESSAGE, type CheckOptions } from "@/lib/net/safe-url";
import { getTileToggles, setTileTogglesIn } from "@/lib/tile-toggles";
import { clientAgentSecretRefused, sealClientAgentSecretWrite } from "@/lib/tools/client-agent-secret";
import {
  clientAgentRefused,
  currentOutboundTools,
  currentReceptionistTools,
  outboundToolsRefused,
  planOutboundToolsWrite,
  planReceptionistToolsWrite,
} from "@/lib/tools/store";

export type ToolsWriteResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; body: { error: string; fields?: string[]; message?: string } };

/**
 * T5: a client agent url in the patch must be a SAFE address (https, port,
 * public DNS — lib/net/safe-url.ts), checked BEFORE the row lock (DNS can
 * take a moment). "" (none) always passes. 400 unsafe_url + one plain
 * message, never the reason.
 */
export async function clientAgentUrlRefusal(patch: unknown, check?: CheckOptions): Promise<ToolsWriteResult | null> {
  const ca = patch && typeof patch === "object" ? (patch as Record<string, unknown>).clientAgent : undefined;
  const url = ca && typeof ca === "object" ? (ca as Record<string, unknown>).url : undefined;
  if (typeof url !== "string" || url === "") return null;
  const r = await checkAgentUrl(url, check);
  return r.ok
    ? null
    : { ok: false, status: 400, body: { error: "unsafe_url", message: SAFE_URL_MESSAGE, fields: ["tools.clientAgent.url"] } };
}

// ::jsonb cast: postgres-js would serialise the object as text otherwise.
const jsonb = (v: unknown) => sql`${JSON.stringify(v)}::jsonb`;

export async function writeTools(
  userId: string,
  agentId: string | null,
  patch: unknown,
  /** Outbound only: OUTBOUND_TOOLS allows tools for this account (T4). */
  outboundToolsEnabled = false,
  /** Receptionist only: CLIENT_AGENT allows the client agent for this account (T5). */
  clientAgentEnabled = false,
): Promise<ToolsWriteResult> {
  const unsafe = await clientAgentUrlRefusal(patch);
  if (unsafe) return unsafe;
  const sealedLooking = clientAgentSecretRefused(patch);
  if (sealedLooking.length) return { ok: false, status: 400, body: { error: "invalid_tools", fields: sealedLooking } };
  if (agentId) {
    const where = and(eq(outboundAgents.id, agentId), eq(outboundAgents.userId, userId));
    const [row] = await db.select({ toolsConfig: outboundAgents.toolsConfig }).from(outboundAgents).where(where).limit(1);
    if (!row) return { ok: false, status: 404, body: { error: "not_found" } };
    const plan = planOutboundToolsWrite(row.toolsConfig, patch);
    if (!plan.ok) return { ok: false, status: 400, body: { error: "invalid_tools", fields: plan.errors } };
    const refused = outboundToolsRefused(currentOutboundTools(row.toolsConfig), plan.value, outboundToolsEnabled);
    if (refused.length) return { ok: false, status: 403, body: { error: "outbound_tools_disabled", fields: refused } };
    await db.update(outboundAgents).set({ toolsConfig: jsonb(sealClientAgentSecretWrite(plan.value, patch)), updatedAt: new Date() } as never).where(where);
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
    const toggles = await getTileToggles(userId);
    const plan = planReceptionistToolsWrite(row, toggles, patch);
    if (!plan.ok) return { ok: false, status: 400, body: { error: plan.error, fields: plan.fields } };
    const refused = clientAgentRefused(currentReceptionistTools(row, toggles), plan.tools, clientAgentEnabled);
    if (refused.length) return { ok: false, status: 403, body: { error: "client_agent_disabled", fields: refused } };
    await setTileTogglesIn(tx, userId, plan.toggles);
    await tx
      .update(agentConfigs)
      .set({
        // E1: a secret the patch provides is stored sealed (SECRETS_KEY set).
        toolsConfig: jsonb(sealClientAgentSecretWrite(plan.columns.toolsConfig, patch)),
        transferNumber: plan.columns.transferNumber,
        transferNumberParked: plan.columns.transferNumberParked,
        updatedAt: new Date(),
      } as never)
      .where(eq(agentConfigs.userId, userId));
    return { ok: true };
  });
}
