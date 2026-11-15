// agentState: "if a customer calls this account's number now, will the agent
// answer?" — computed by the server (lib/agent-state/compute.ts), shown by the
// dashboard hero. CLIENT-SAFE: no imports, types and constants only; client
// components import it with `import type`.

/** The account has no number yet. */
export type AgentStateToActivate = { state: "to_activate"; reason: null };
/** Every check passes. */
export type AgentStateLive = { state: "live"; reason: null };
/** A number exists but one check fails: `reason` names the first one. */
export type AgentStateAttention = { state: "attention"; reason: AgentStateReason };

export type AgentState = AgentStateToActivate | AgentStateLive | AgentStateAttention;

/**
 * Why a numbered account needs attention, in check order:
 * - subscription_inactive: the plan or trial refuses calls now (the inbound
 *   trial gate, lib/agent/session-config/trial-gate.ts).
 * - config_unavailable: the inbound session config can't be built for the
 *   number (the worker's resolver, run dry).
 */
export type AgentStateReason = "subscription_inactive" | "config_unavailable";
