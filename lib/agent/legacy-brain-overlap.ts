// Guard: an account with BOTH the old own-agent mechanism switched on
// (tenant_agent_brain, served to the worker as `agentWebhook`) AND the new
// "ask your agent" brick set (tools_config.clientAgent enabled with a url).
// The worker still applies the old webhook, so the new brick is silently
// ignored on that account's calls: the admins get one alert per account per
// day (alert ledger, via alertAdmins' key + dedupMs).
// FAIL-OPEN: this never changes nor fails the call payload. It reads only
// values the inbound path already computed, and every throw (sync or async,
// in the check or in the alert sink) is swallowed.
// The alert carries the internal account id only (as the other per-account
// call-path alerts do): never an email, a url nor a secret.

import { fireSafely } from "./fire-safely";

const DAY_MS = 24 * 60 * 60 * 1000;

export const LEGACY_BRAIN_OVERLAP_ALERT_PREFIX = "agent_brain_overlap:";

export function legacyBrainOverlapAlertKey(userId: string): string {
  return `${LEGACY_BRAIN_OVERLAP_ALERT_PREFIX}${userId}`;
}

/** Both mechanisms set on the stored settings. Pure. */
export function legacyAndClientAgentBothSet(
  brain: { enabled: boolean } | null | undefined,
  clientAgent: { enabled: boolean; url: string } | null | undefined,
): boolean {
  return (
    brain?.enabled === true &&
    clientAgent?.enabled === true &&
    typeof clientAgent.url === "string" &&
    clientAgent.url.trim() !== ""
  );
}

type OverlapAlert = (args: {
  key: string;
  subject: string;
  body: string;
  dedupMs: number;
  severity?: "critical" | "warning";
}) => Promise<unknown>;

/**
 * Raises the overlap alert when both are set. Never throws, never rejects.
 * Returns whether the alert sink was called (for tests).
 */
export async function alertLegacyBrainOverlapSafely(args: {
  userId: string;
  brain: { enabled: boolean } | null | undefined;
  clientAgent: { enabled: boolean; url: string } | null | undefined;
  alert: OverlapAlert;
}): Promise<boolean> {
  let bothSet: boolean;
  try {
    bothSet = legacyAndClientAgentBothSet(args.brain, args.clientAgent);
  } catch {
    // Fail-open: the call payload never depends on this alert.
    return false;
  }
  if (!bothSet) return false;
  return fireSafely(() =>
    args.alert({
      key: legacyBrainOverlapAlertKey(args.userId),
      subject: "Old own-agent mechanism overrides the new one",
      body:
        `Account ${args.userId} has BOTH the old own-agent mechanism switched on and the new "ask your agent" brick set. ` +
        "The worker still applies the old webhook, so the new brick is silently ignored on its calls. " +
        "Switch the old mechanism off for this account.",
      dedupMs: DAY_MS,
      severity: "warning",
    }),
  );
}
