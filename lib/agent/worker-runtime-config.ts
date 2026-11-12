// The agent_configs columns the inbound worker payload spreads
// (lib/agent/session-config/inbound.ts → /api/agent/config phone/web and
// /api/agent/session-config phone/web/call_me). The row is spread, so every
// column is served UNLESS it is listed here: a new column must be added to
// one of the two lists in scripts/tests/worker-runtime-config.test.ts, which
// pins the served key set.

import type { agentConfigs } from "@/lib/db/schema";

type ConfigRow = typeof agentConfigs.$inferSelect;

/** Columns never served to the worker. */
export const WORKER_HIDDEN_CONFIG_COLUMNS = [
  // Internal ids.
  "id",
  "userId",
  // P3: calls still read the legacy persona columns.
  "personaConfig",
  // T3: calls read the tile toggles + transferNumber.
  "toolsConfig",
  "transferNumberParked",
  // Owner recap by email (#297): the web sends it at call end; the worker
  // has no use for the owner's address.
  "ownerRecapEmail",
  "ownerRecapEmailEnabled",
] as const satisfies ReadonlyArray<keyof ConfigRow>;

type Hidden = (typeof WORKER_HIDDEN_CONFIG_COLUMNS)[number];

/** The row without the hidden columns (updatedAt included: served last). */
export function workerRuntimeConfig(config: ConfigRow): Omit<ConfigRow, Hidden> {
  const out: Record<string, unknown> = { ...config };
  for (const k of WORKER_HIDDEN_CONFIG_COLUMNS) delete out[k];
  return out as Omit<ConfigRow, Hidden>;
}
