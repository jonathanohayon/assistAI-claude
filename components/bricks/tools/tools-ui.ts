// Tools brick (T2) — pure helpers for the one "what the agent can do"
// screen. Tenant-safe: no supplier word, no technical tool name (those are
// admin-only, sent by the server in the admin response only).
//
// The screen never recomputes a capability: it renders the server's
// effectiveCapabilities (the same function the call uses). These helpers
// only decide how a given state is SHOWN.

import {
  CAPABILITY_KEYS,
  type CapabilityKey,
  type CapabilityState,
  type EffectiveCapabilities,
  type MissingPrerequisite,
  type Tools,
} from "@/lib/tools/contract";

/** GET/PUT /api/dashboard/tools (T3). `admin` is in an admin's response only. */
export interface ToolsResponse {
  tools: Tools;
  capabilities: EffectiveCapabilities;
  account: { googleConnected: boolean; transferNumberSet: boolean };
  /** For a capability the plan doesn't include: the plan that does. */
  upgrade: Partial<Record<CapabilityKey, string>>;
  admin?: { toolNames: Record<CapabilityKey, string[]> };
}

export type CapabilityStatus =
  /** Switch off. */
  | "off"
  /** On, and nothing missing: what the call gets. */
  | "on"
  /** On, but a prerequisite is missing: "Not active yet: <why>". */
  | "pending";

export type PrerequisiteAction = "connectGoogle" | "addNumber" | null;

export interface CapabilityView {
  key: CapabilityKey;
  status: CapabilityStatus;
  missing: MissingPrerequisite | null;
  action: PrerequisiteAction;
}

const ACTION: Record<MissingPrerequisite, PrerequisiteAction> = {
  google_not_connected: "connectGoogle",
  no_transfer_number: "addNumber",
  // Nothing the customer can do: outbound tools come with T4.
  not_available_outbound: null,
};

/**
 * How one capability reads. A missing prerequisite always says so, even when
 * the call would still get the tool (`active` true): until prerequisites are
 * enforced on the call (T1b), the screen is the honest one.
 */
export function capabilityView(key: CapabilityKey, s: CapabilityState): CapabilityView {
  const missing = s.prerequisite.met ? null : s.prerequisite.missing;
  if (!s.requested) return { key, status: "off", missing, action: null };
  if (missing) return { key, status: "pending", missing, action: ACTION[missing] };
  return { key, status: "on", missing: null, action: null };
}

/**
 * Level 1: the switches (plan includes them) and the capabilities the plan
 * doesn't include, which are never shown as switches but gathered in ONE
 * line at the bottom ("Available with the … plan").
 */
export function capabilityList(caps: EffectiveCapabilities): { switches: CapabilityView[]; notInPlan: CapabilityKey[] } {
  const switches: CapabilityView[] = [];
  const notInPlan: CapabilityKey[] = [];
  for (const key of CAPABILITY_KEYS) {
    const s = caps[key];
    if (!s.planIncluded) notInPlan.push(key);
    else switches.push(capabilityView(key, s));
  }
  return { switches, notInPlan };
}

/** The PUT body: only the switches that changed, key by key. Empty = nothing to save. */
export function toolsPatch<T extends object>(baseIn: T, nextIn: T): Record<string, unknown> {
  const base = baseIn as Record<string, unknown>;
  const next = nextIn as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(next)) {
    if (k === "version") continue;
    const a = base[k] as Record<string, unknown> | undefined;
    const b = next[k] as Record<string, unknown>;
    if (b && typeof b === "object" && !Array.isArray(b)) {
      const diff: Record<string, unknown> = {};
      for (const f of Object.keys(b)) if (JSON.stringify(a?.[f]) !== JSON.stringify(b[f])) diff[f] = b[f];
      if (Object.keys(diff).length) out[k] = diff;
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      out[k] = b;
    }
  }
  return out;
}
