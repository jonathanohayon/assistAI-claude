// The agentState decision: ordered checks, first failure wins. Pure apart from
// the injected checks, which run lazily (a later check never runs after an
// earlier failure: no resolver dry run for an account without a number).

import type { AgentState } from "./types";

type Check = () => boolean | Promise<boolean>;

export interface AgentStateChecks {
  /** 1. The account has a number (false → to_activate). */
  hasNumber: Check;
  /** 2. The plan or trial allows calls now (false → subscription_inactive). */
  subscriptionAllowsCalls: Check;
  /** 3. The inbound session config builds for the number (false → config_unavailable). */
  configAvailable: Check;
}

export async function decideAgentState(checks: AgentStateChecks): Promise<AgentState> {
  if (!(await checks.hasNumber())) return { state: "to_activate", reason: null };
  if (!(await checks.subscriptionAllowsCalls())) return { state: "attention", reason: "subscription_inactive" };
  if (!(await checks.configAvailable())) return { state: "attention", reason: "config_unavailable" };
  return { state: "live", reason: null };
}
