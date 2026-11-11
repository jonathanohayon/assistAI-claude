// The Tools contract (brick T1): what an agent may do during a call beyond
// talking. Pure, client-safe (no DB import).
//
// A capability is ACTIVE on a call only if the customer turned it on
// (`requested`), the plan includes it (`planIncluded`) and its prerequisite
// is met — ONE function, effectiveCapabilities, for the screen and the call.
// The screen shows "Not active yet: <why>" whenever prerequisite.met is
// false, whatever `active` says (see PREREQUISITES_ENFORCED_ON_CALL).

import type { PlanFeatures } from "@/lib/plan-features";

export const TOOLS_VERSION = 1 as const;

export const CAPABILITY_KEYS = ["booking", "contacts", "transfer", "orders"] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export const TRANSFER_WHEN = ["always", "business_hours"] as const;
export type TransferWhen = (typeof TRANSFER_WHEN)[number];

/**
 * The agent's own switches + per-capability settings (stored with the agent
 * since T3). Level-2 settings (durations, transfer.when, orders.ask) are
 * STORED ONLY: calls don't read them yet, so the screen hides them until the
 * reader step ships (null / "always" / "" = today's behaviour).
 */
export interface Tools {
  version: typeof TOOLS_VERSION;
  booking: { enabled: boolean; defaultDurationMinutes: number | null; minNoticeMinutes: number | null };
  contacts: { enabled: boolean };
  transfer: { enabled: boolean; when: TransferWhen };
  orders: { enabled: boolean; ask: string };
}

/** Stable machine codes — the screen maps them to words. */
export type MissingPrerequisite = "google_not_connected" | "no_transfer_number" | "not_available_outbound";

export interface CapabilityState {
  /** The customer's switch. */
  requested: boolean;
  planIncluded: boolean;
  prerequisite: { met: boolean; missing: MissingPrerequisite | null };
  /** What the call gets. */
  active: boolean;
}

export type EffectiveCapabilities = Record<CapabilityKey, CapabilityState>;

/**
 * Off: a missing Google connection does NOT turn booking/contacts off on the
 * call — today's behaviour (the tools are offered and fail during the call).
 * Turning it on is its own step, after a test call. Prerequisites today's
 * code already enforces (transfer number, outbound) are enforced regardless.
 */
export const PREREQUISITES_ENFORCED_ON_CALL = false;

const ENFORCED_TODAY: Record<MissingPrerequisite, boolean> = {
  google_not_connected: false,
  no_transfer_number: true,
  not_available_outbound: true,
};

export interface CapabilityAgent {
  recipe: "receptionist" | "outbound";
  tools: Tools;
}
export interface CapabilityAccount {
  transferNumber: string;
  googleConnected: boolean;
  /**
   * Outbound only (T4): the OUTBOUND_TOOLS site switch for this account
   * (lib/tools/outbound-switch.ts). Absent / false = no tool on outbound
   * calls, exactly as before.
   */
  outboundToolsEnabled?: boolean;
}

/** Capabilities an outbound agent can have once OUTBOUND_TOOLS allows it (T4). */
export const OUTBOUND_CAPABILITIES: readonly CapabilityKey[] = ["booking", "transfer"];

export function effectiveCapabilities(agent: CapabilityAgent, account: CapabilityAccount, plan: PlanFeatures): EffectiveCapabilities {
  const outbound = agent.recipe === "outbound";
  const state = (key: CapabilityKey, requested: boolean, planIncluded: boolean, missing: MissingPrerequisite | null): CapabilityState => {
    // Outbound (T4): booking and transfer only, and only when the site
    // switch allows it for this account; otherwise not available, as before.
    // From there: the SAME rules as the receptionist.
    const outboundOk = account.outboundToolsEnabled === true && OUTBOUND_CAPABILITIES.includes(key);
    const m: MissingPrerequisite | null = outbound && !outboundOk ? "not_available_outbound" : missing;
    const blocking = m !== null && (PREREQUISITES_ENFORCED_ON_CALL || ENFORCED_TODAY[m]);
    return { requested, planIncluded, prerequisite: { met: m === null, missing: m }, active: requested && planIncluded && !blocking };
  };
  const google = account.googleConnected ? null : "google_not_connected";
  return {
    booking: state("booking", agent.tools.booking.enabled, plan.calendar, google),
    // Contacts go to the customer's Google Sheet (app/api/sheets/contact).
    contacts: state("contacts", agent.tools.contacts.enabled, plan.crm, google),
    // No plan feature for transfer: every plan includes it.
    // Same test as the worker (a non-empty string registers transfer_call).
    transfer: state("transfer", agent.tools.transfer.enabled, true, account.transferNumber ? null : "no_transfer_number"),
    // Orders ride on the CRM plan feature; no prerequisite.
    orders: state("orders", agent.tools.orders.enabled, plan.crm, null),
  };
}
