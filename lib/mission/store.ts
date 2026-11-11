// Storing the sales mission on the outbound AGENT (M2a, write-alongside).
// Pure, client-safe.
//
// - outbound_agents.mission holds { version, kind, cold } (NULL = never set).
//   Decision 1 (tamaraVP): the mission lives on the agent; a campaign may
//   refine the objective in one sentence without changing the mission.
// - NOTHING reads it for the instructions yet: the served instructions keep
//   coming from the campaign's goal fields (goal_preset, objective,
//   success_criteria).
// - Save body: `mission` ABSENT = keep the stored value; `null` = clear;
//   an object = validated (unknown key / kind → 400 naming the field).
// - Only the agent's own GET returns it: every other route spreading the
//   row strips it (withoutMissionStore).

import { MISSION_VERSION, SALES_MISSIONS, SALES_MISSION_TABLE, type SalesMission } from "@/lib/mission/contract";

/** The value stored in outbound_agents.mission. */
export interface AgentMission {
  version: typeof MISSION_VERSION;
  kind: SalesMission;
  cold: boolean;
}

export type MissionWriteError = { status: 400; body: { error: "invalid_mission"; fields: string[] } };

type Parse<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const KEYS = ["version", "kind", "cold"] as const;

/** A mission value, strict: known keys only; `version` (=1) and `cold` optional. */
export function parseAgentMission(input: unknown): Parse<AgentMission> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: ["mission: must be an object or null"] };
  const o = input as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of Object.keys(o)) if (!(KEYS as readonly string[]).includes(k)) errors.push(`mission.${k}: unknown field`);
  if (o.version !== undefined && o.version !== MISSION_VERSION) errors.push(`mission.version: must be ${MISSION_VERSION}`);
  const kindOk = (SALES_MISSIONS as readonly unknown[]).includes(o.kind);
  if (!kindOk) errors.push(`mission.kind: one of ${SALES_MISSIONS.join(", ")}`);
  if (o.cold !== undefined && typeof o.cold !== "boolean") errors.push("mission.cold: must be a boolean");
  else if (o.cold === true && kindOk && !SALES_MISSION_TABLE[o.kind as SalesMission].allowsCold)
    errors.push("mission.cold: only with kind qualify_lead");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { version: MISSION_VERSION, kind: o.kind as SalesMission, cold: o.cold === true } };
}

/** The stored value as the agent's GET returns it (null when unset or unreadable). */
export function currentAgentMission(stored: unknown): AgentMission | null {
  if (stored == null) return null;
  const p = parseAgentMission(stored);
  return p.ok ? p.value : null;
}

/**
 * A save body → the `mission` column update. null = `mission` absent from
 * the body: the stored value is kept (nothing to write).
 */
export function agentMissionUpdates(
  body: Record<string, unknown>,
): { error: MissionWriteError } | { updates: { mission: AgentMission | null } } | null {
  if (!Object.prototype.hasOwnProperty.call(body, "mission") || body.mission === undefined) return null;
  if (body.mission === null) return { updates: { mission: null } };
  const p = parseAgentMission(body.mission);
  if (!p.ok) return { error: { status: 400, body: { error: "invalid_mission", fields: p.errors } } };
  return { updates: { mission: p.value } };
}

/** A row without the mission store: for every route that spreads an outbound_agents row. */
export function withoutMissionStore<T extends Record<string, unknown>>(row: T): Omit<T, "mission"> {
  const { mission: _m, ...rest } = row;
  void _m;
  return rest;
}
