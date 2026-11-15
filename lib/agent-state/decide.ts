// The agentState decision: ordered checks, first failure wins. Pure apart from
// the injected checks, which run lazily (a later check never runs after an
// earlier failure: no resolver dry run for an account without a number).

import { heartbeatProblem, type WorkerHeartbeat } from "@/lib/monitoring-rules";

import type { AgentState } from "./types";

type Check = () => boolean | Promise<boolean>;

export interface AgentStateChecks {
  /** 1. The account has a number (false → to_activate). */
  hasNumber: Check;
  /** 2. The plan or trial allows calls now (false → subscription_inactive). */
  subscriptionAllowsCalls: Check;
  /** 3. The inbound session config builds for the number (false → config_unavailable). */
  configAvailable: Check;
  /** 4. The voice worker is alive (false → engine_unreachable). See engineReachable. */
  engineReachable: Check;
}

export async function decideAgentState(checks: AgentStateChecks): Promise<AgentState> {
  if (!(await checks.hasNumber())) return { state: "to_activate", reason: null };
  if (!(await checks.subscriptionAllowsCalls())) return { state: "attention", reason: "subscription_inactive" };
  if (!(await checks.configAvailable())) return { state: "attention", reason: "config_unavailable" };
  if (!(await checks.engineReachable())) return { state: "attention", reason: "engine_unreachable" };
  return { state: "live", reason: null };
}

/**
 * "A heartbeat was ever recorded" = the `worker_heartbeat` app_settings row
 * exists, its value is JSON, and its `at` is a finite epoch-ms number (what
 * recordHeartbeat in lib/monitoring.ts writes). Anything else (no row,
 * unparseable JSON, missing or non-numeric `at`) counts as NEVER recorded.
 * `stored` is what readHeartbeat returns (null for no row / bad JSON).
 */
export function recordedHeartbeat(stored: unknown): WorkerHeartbeat | null {
  if (!stored || typeof stored !== "object") return null;
  const at = (stored as { at?: unknown }).at;
  return typeof at === "number" && Number.isFinite(at) ? (stored as WorkerHeartbeat) : null;
}

/**
 * Check 4 (engine_unreachable): false when the global worker heartbeat is
 * older than HEARTBEAT_STALE_MS (12 min). It reuses heartbeatProblem
 * (lib/monitoring-rules.ts), the rule behind the admin "Voice agent DOWN"
 * alert: no second threshold.
 * keys.openai === "invalid" is NOT treated as unreachable here.
 *
 * LIMITS of this check:
 *   1. It is GLOBAL, not per replica: there is one heartbeat row for the whole
 *      worker fleet, so one dead replica out of two is not seen.
 *   2. It proves the worker PROCESS is alive and reaches the web, not that
 *      LiveKit dispatches calls to it.
 *   3. Dev case: where no heartbeat was ever recorded (a machine without a
 *      worker), the check is SKIPPED (true), never "attention".
 */
export function engineReachable(stored: unknown, now: number): boolean {
  const hb = recordedHeartbeat(stored);
  if (!hb) return true; // limit 3: never recorded → skipped
  return heartbeatProblem(hb, now) === null;
}
