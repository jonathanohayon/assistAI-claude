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
  type PublicTools,
} from "@/lib/tools/contract";

/** Which screen the brick is on: the receptionist or an outbound agent. */
export type ToolsKind = "inbound" | "outbound";

/** GET/PUT /api/dashboard/tools (T3). `admin` is in an admin's response only. */
export interface ToolsResponse {
  /** The client agent's secret is never sent: `clientAgent.secretSet` instead. */
  tools: PublicTools;
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
  /** T5: whether this account's screen shows "Ask your agent" (server decision). */
  clientAgentTool?: { visible: boolean };
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

/** A row on the screen: the plan capabilities, plus "Ask your agent" (T5b). */
export type ShownKey = CapabilityKey | "clientAgent";

export interface CapabilityView {
  key: ShownKey;
  status: CapabilityStatus;
  missing: MissingPrerequisite | null;
  action: PrerequisiteAction;
}

const ACTION: Record<MissingPrerequisite, PrerequisiteAction> = {
  google_not_connected: "connectGoogle",
  no_transfer_number: "addNumber",
  // Nothing the customer can do (the outbound screen leaves these out).
  not_available_outbound: null,
  // T5 ("Ask your agent"): the screen shows that tool only when visible.
  client_agent_disabled: null,
  no_agent_url: null,
};

/**
 * How one capability reads. A missing prerequisite always says so, even when
 * the call would still get the tool (`active` true): until prerequisites are
 * enforced on the call (T1b), the screen is the honest one.
 */
export function capabilityView(key: ShownKey, s: CapabilityState): CapabilityView {
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
  return switches
    .filter((v) => v.status === "pending" && v.missing === "google_not_connected")
    .map((v) => v.key)
    .filter((k): k is CapabilityKey => k !== "clientAgent");
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
export function capabilityWhatKey(key: ShownKey, kind: ToolsKind): string {
  return kind === "outbound" && key === "transfer" ? "cap.transfer.whatOutbound" : `cap.${key}.what`;
}

// ── "Ask your agent" (T5b): the customer's own agent, asked during calls ──

/**
 * What the screen holds: what GET sends, plus — only between "Generate" and
 * the save — the new secret (a string) or its removal (null). Never filled
 * from a server answer: after a save or a reload it is gone again.
 */
export type ScreenTools = Omit<PublicTools, "clientAgent"> & {
  clientAgent: PublicTools["clientAgent"] & { secret?: string | null };
};

/**
 * Whether the "Ask your agent" row exists. Receptionist only, and only when
 * the server says so for this account; a missing answer counts as no.
 */
export function clientAgentRowVisible(kind: ToolsKind, served: ToolsResponse | null | undefined): boolean {
  return kind === "inbound" && served?.clientAgentTool?.visible === true;
}

/** The row's state: the server's prerequisites, the screen's (unsaved) switch. */
export function clientAgentView(served: ToolsResponse, tools: ScreenTools): CapabilityView {
  return capabilityView("clientAgent", { ...served.capabilities.clientAgent, requested: tools.clientAgent.enabled });
}

/** Bytes of randomness in a generated secret (256 bits). */
export const SECRET_BYTES = 32;

/**
 * A strong signing secret, made in the browser: 32 random bytes, base64url
 * (43 characters, no padding). `fill` is injectable for tests only.
 */
export function generateClientAgentSecret(
  fill: (b: Uint8Array) => Uint8Array = (b) => globalThis.crypto.getRandomValues(b),
): string {
  const bytes = fill(new Uint8Array(SECRET_BYTES));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * How the secret field reads. "new": generated, shown once, not saved yet;
 * "removing": cleared on save; otherwise the server's secretSet. Never the
 * value itself (only the one-time box shows a "new" one).
 */
export type SecretState = "new" | "removing" | "set" | "unset";
export function secretState(tools: ScreenTools): SecretState {
  const s = tools.clientAgent.secret;
  if (typeof s === "string") return "new";
  if (s === null) return tools.clientAgent.secretSet ? "removing" : "unset";
  return tools.clientAgent.secretSet ? "set" : "unset";
}

/**
 * The tools PUT body: only what changed (toolsPatch) — so `secret` is sent
 * only once generated (a string) or removed (null) — and, whenever the
 * client agent is touched, its CURRENT `enabled` too (live-bug rule: a
 * partial clientAgent save never leaves the switch to a server default).
 */
export function toolsSaveBody(base: ScreenTools, next: ScreenTools): Record<string, unknown> {
  const patch = toolsPatch(base, next);
  const ca = patch.clientAgent as Record<string, unknown> | undefined;
  if (ca) patch.clientAgent = { ...ca, enabled: next.clientAgent.enabled };
  return patch;
}

/**
 * The test request's body: the UNSAVED address, and the secret only when
 * one was generated (string) or removed (null). Omitted, the server signs
 * with the stored secret when the address is the stored one.
 */
export function clientAgentTestBody(tools: ScreenTools): { url: string; secret?: string | null } {
  const { url, secret } = tools.clientAgent;
  return secret === undefined ? { url: url.trim() } : { url: url.trim(), secret };
}

const TEST_REASONS = ["blocked_address", "timeout", "http_status", "bad_shape", "too_large", "network", "no_agent_url"] as const;

/** The message key under ToolsBrick.agent.test for one test answer. */
export type TestWords =
  | { key: "ok"; ms: number }
  | { key: (typeof TEST_REASONS)[number] | "rateLimited" | "disabled" | "generic" };

/**
 * POST /api/dashboard/tools/client-agent/test → one calm line. Only known
 * codes map to words; nothing the server (or the customer's agent) sent is
 * ever shown: no address, no remote body, no status number.
 */
export function clientAgentTestWords(status: number, body: unknown): TestWords {
  const b = (body && typeof body === "object" ? body : {}) as { ok?: unknown; ms?: unknown; reason?: unknown; error?: unknown };
  if (status === 429) return { key: "rateLimited" };
  if (status === 403 && b.error === "client_agent_disabled") return { key: "disabled" };
  if (status !== 200) return { key: "generic" };
  if (b.ok === true && typeof b.ms === "number" && Number.isFinite(b.ms) && b.ms >= 0) return { key: "ok", ms: Math.round(b.ms) };
  if (b.ok === false) {
    const r = TEST_REASONS.find((x) => x === b.reason);
    if (r) return { key: r };
  }
  return { key: "generic" };
}

/**
 * A refused save, for the "Ask your agent" row: 403 client_agent_disabled →
 * "disabled"; 400 unsafe_url → "unsafeUrl"; anything else null (the
 * caller's generic error). Words only, never the server's message.
 */
export type ClientAgentRefusal = "disabled" | "unsafeUrl";
export function clientAgentSaveRefusal(status: number, body: unknown): ClientAgentRefusal | null {
  const b = body as { error?: unknown } | null;
  if (status === 403 && b?.error === "client_agent_disabled") return "disabled";
  if (status === 400 && b?.error === "unsafe_url") return "unsafeUrl";
  return null;
}
