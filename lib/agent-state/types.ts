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
 * - trial_ended: the trial refuses calls because its end date has passed or
 *   the account is trial_paused (the inbound trial gate,
 *   lib/agent/session-config/trial-gate.ts). Also when the minutes are used
 *   up too: the end date wins.
 * - trial_minutes_exhausted: the trial is still running but its minutes
 *   (TRIAL_SECONDS_LIMIT) are used up (same gate).
 * - config_unavailable: the inbound session config can't be built for the
 *   number (the worker's resolver, run dry).
 * - engine_unreachable: the voice worker's global heartbeat is stale (more
 *   than 12 min old). Only where a heartbeat was ever recorded; see
 *   lib/agent-state/decide.ts for the limits of this check.
 *
 * Paid plans never get a trial reason (no minutes refusal: overage).
 * "subscription_inactive" is deliberately NOT a reason: it is reserved for a
 * future paid-plan check (e.g. a lapsed payment) that does not exist yet.
 */
export type AgentStateTrialReason = "trial_ended" | "trial_minutes_exhausted";
export type AgentStateReason = AgentStateTrialReason | "config_unavailable" | "engine_unreachable";
