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
  OUTBOUND_CAPABILITIES,
  type Tools,
} from "@/lib/tools/contract";

/** Which screen the brick is on: the receptionist or an outbound agent. */
export type ToolsKind = "inbound" | "outbound";

/** GET/PUT /api/dashboard/tools (T3). `admin` is in an admin's response only. */
export interface ToolsResponse {
  tools: Tools;
  capabilities: EffectiveCapabilities;
  /** transferNumber: the KEPT number (stored, or parked while transfer is off), E.164; null = none. */
  account: { googleConnected: boolean; transferNumberSet: boolean; transferNumber?: string | null };
  /** For a capability the plan doesn't include: the plan that does. */
  upgrade: Partial<Record<CapabilityKey, string>>;
  admin?: { toolNames: Record<CapabilityKey, string[]> };
  /**
   * Outbound agent only (T4): the server's decision for this account (never
   * the site switch's raw value). false = the editor shows no tools at all.
   */
  outboundTools?: { visible: boolean };
}

/**
 * Whether the Tools brick (and its tile) exists on this screen. The
 * receptionist always has it; an outbound agent only when the server says
 * so — a missing answer (new agent, still loading, error) counts as no.
 */
export function toolsBrickVisible(kind: ToolsKind, served: ToolsResponse | null | undefined): boolean {
  if (kind === "inbound") return true;
  return served?.outboundTools?.visible === true;
}

/**
 * The capabilities a screen lists. Outbound: booking and transfer only —
 * the others are not shown at all (no row, no "not available" line).
 */
export function shownCapabilities(kind: ToolsKind): readonly CapabilityKey[] {
  return kind === "outbound" ? OUTBOUND_CAPABILITIES : CAPABILITY_KEYS;
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
  // Nothing the customer can do (the outbound screen leaves these out).
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
export function capabilityList(
  caps: EffectiveCapabilities,
  kind: ToolsKind = "inbound",
): { switches: CapabilityView[]; notInPlan: CapabilityKey[] } {
  const switches: CapabilityView[] = [];
  const notInPlan: CapabilityKey[] = [];
  for (const key of shownCapabilities(kind)) {
    const s = caps[key];
    // Never a switch the call can't use: a capability the server still
    // reports as unavailable outbound is left out, not shown as "off".
    if (kind === "outbound" && s.prerequisite.missing === "not_available_outbound") continue;
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

/**
 * The tile summary's count: capabilities the screen calls active ("on").
 * Not `active` alone: until T1b a capability can be active on the call
 * while the screen honestly says "Not active yet".
 */
export function activeCount(caps: EffectiveCapabilities, kind: ToolsKind = "inbound"): number {
  return capabilityList(caps, kind).switches.filter((v) => v.status === "on").length;
}

/**
 * A refused tools save, in the brick's terms. 403 outbound_tools_disabled →
 * the capabilities the server would not turn on (from `fields`, e.g.
 * "tools.booking.enabled"); anything else → null (the caller's generic
 * error). The screen shows words for these keys, never the server's code.
 */
export function refusedCapabilities(status: number, body: unknown): CapabilityKey[] | null {
  const b = body as { error?: unknown; fields?: unknown } | null;
  if (status !== 403 || b?.error !== "outbound_tools_disabled") return null;
  const fields = Array.isArray(b.fields) ? b.fields : [];
  return CAPABILITY_KEYS.filter((k) => fields.includes(`tools.${k}.enabled`));
}

/**
 * One Google notice above the list instead of a button per row: the
 * switched-on capabilities waiting for the Google account, in list order.
 */
export function waitingForGoogle(switches: CapabilityView[]): CapabilityKey[] {
  return switches.filter((v) => v.status === "pending" && v.missing === "google_not_connected").map((v) => v.key);
}

/**
 * A number the way people dial it at home ("050 000 0000", "06 12 34 56 78");
 * anything else as stored. Shown isolated left-to-right.
 */
export function localPhone(e164: string): string {
  const raw = e164.replace(/[\s-]/g, "");
  const il = /^\+972([57]\d)(\d{3})(\d{4})$/.exec(raw);
  if (il) return `0${il[1]} ${il[2]} ${il[3]}`;
  const ilLand = /^\+972([23489])(\d{3})(\d{4})$/.exec(raw);
  if (ilLand) return `0${ilLand[1]} ${ilLand[2]} ${ilLand[3]}`;
  const fr = /^\+33(\d)(\d{8})$/.exec(raw);
  if (fr) return `0${fr[1]} ${fr[2].match(/\d{2}/g)!.join(" ")}`;
  return e164;
}

/** "Book appointments" → "book appointments" inside a sentence (no-op for Hebrew). */
export const inSentence = (name: string, locale: string): string =>
  name.charAt(0).toLocaleLowerCase(locale) + name.slice(1);

/**
 * The message key for a capability's one-line description on this screen.
 * Outbound wording where the receptionist's would be wrong: on an outbound
 * call nobody is "the caller" (we called them), so transfer has its own line.
 */
export function capabilityWhatKey(key: CapabilityKey, kind: ToolsKind): string {
  return kind === "outbound" && key === "transfer" ? "cap.transfer.whatOutbound" : `cap.${key}.what`;
}
