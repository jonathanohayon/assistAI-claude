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
 * "Ask your agent" (T5): the customer's own agent, called as a TOOL during
 * calls (ONE contract: `question` → `answer`, 2.5 s). Per-agent mode:
 *   lead  — Tamara leads the call and asks the agent;
 *   voice — Tamara only lends her voice: same tool, says the answer as-is.
 * Behind the CLIENT_AGENT site switch (lib/tools/client-agent-switch.ts).
 * NOT one of CAPABILITY_KEYS: the existing screen and plan matrix don't list
 * it; the screen shows it only when GET says `clientAgentTool.visible`.
 */
export const CLIENT_AGENT_MODES = ["lead", "voice"] as const;
export type ClientAgentMode = (typeof CLIENT_AGENT_MODES)[number];
export interface ClientAgentSettings {
  enabled: boolean;
  /** "" = none. https only, checked by lib/net/safe-url.ts at save and serve. */
  url: string;
  mode: ClientAgentMode;
}
/**
 * The client agent as STORED: + its HMAC secret (null = none). The secret is
 * WRITE-ONLY: no response carries it — responses use PublicTools (secretSet).
 */
export type ClientAgentStored = ClientAgentSettings & { secret: string | null };

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
  clientAgent: ClientAgentStored;
}

/** Tools as every response shows them: the secret replaced by `secretSet`. */
export type PublicTools = Omit<Tools, "clientAgent"> & { clientAgent: ClientAgentSettings & { secretSet: boolean } };

export function publicTools(t: Tools): PublicTools {
  const { secret, ...rest } = t.clientAgent;
  return { ...t, clientAgent: { ...rest, secretSet: Boolean(secret) } };
}

export const CLIENT_AGENT_OFF: ClientAgentStored = { enabled: false, url: "", mode: "lead", secret: null };

/** Stable machine codes — the screen maps them to words. */
export type MissingPrerequisite =
  | "google_not_connected"
  | "no_transfer_number"
  | "not_available_outbound"
  /** T5: the CLIENT_AGENT site switch is off for this account. */
  | "client_agent_disabled"
  /** T5: no usable agent url (empty, or not a safe https address). */
  | "no_agent_url";

export interface CapabilityState {
  /** The customer's switch. */
  requested: boolean;
  planIncluded: boolean;
  prerequisite: { met: boolean; missing: MissingPrerequisite | null };
  /** What the call gets. */
  active: boolean;
}

export type EffectiveCapabilities = Record<CapabilityKey, CapabilityState> & { clientAgent: CapabilityState };

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
  client_agent_disabled: true,
  no_agent_url: true,
};

export interface CapabilityAgent {
  recipe: "receptionist" | "outbound";
  tools: Tools;
  /**
   * T5: tools.clientAgent.url passes the static URL check (https, port, no
   * internal name or blocked IP literal — lib/net/safe-url.ts). Computed by
   * the server (this module stays client-safe). Absent = false.
   */
  clientAgentUrlOk?: boolean;
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
  /** T5: the CLIENT_AGENT site switch for this account. Absent / false = off. */
  clientAgentEnabled?: boolean;
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
    // T5: receptionist only (outbound → not_available_outbound, like the
    // other non-outbound capabilities); no plan feature; the site switch,
    // then a usable url.
    clientAgent: (() => {
      const m: MissingPrerequisite | null = outbound
        ? "not_available_outbound"
        : account.clientAgentEnabled !== true
          ? "client_agent_disabled"
          : agent.clientAgentUrlOk === true
            ? null
            : "no_agent_url";
      const requested = agent.tools.clientAgent.enabled;
      return { requested, planIncluded: true, prerequisite: { met: m === null, missing: m }, active: requested && m === null };
    })(),
  };
}
