/**
 * What the dashboard hero may claim about the agent answering calls.
 *
 * Source of truth: `stats.agentState`, computed by the server
 * (lib/agent-state/compute.ts: number → subscription/trial → inbound config
 * → worker heartbeat).
 * When it is missing or not a shape we know, we fall back to the older rule
 * (#319): a phone number means "live", no number means "to activate". The
 * fallback NEVER yields "attention": a warning is only shown when the server
 * said so.
 *
 * Adding a state is one row in HERO_STATES plus its message keys. Rows are
 * keyed by "state" or "attention:<reason>" as plain strings, so a payload
 * newer than this build still renders safely: an attention reason without a
 * row falls back to the number rule. The server shape is
 * lib/agent-state/types.ts (AgentState).
 */

export type HeroStatus = "live" | "to_activate" | "attention";

/** Colour family: cyan (live), amber (the owner can act), grey (nothing to do). */
export type HeroTone = "live" | "warning" | "neutral";

/** The call to action shown with the hero's status line. */
export type HeroAction = "get_number" | "plans" | "support";

export type HeroLiveState = {
  status: HeroStatus;
  /** Only true when the agent answers: drives the pings and the waveform. */
  live: boolean;
  tone: HeroTone;
  /** DashboardConfig key shown after the eyebrow. */
  eyebrowStatusKey: "heroLive" | "heroToActivate" | "heroAttention" | "heroOffline";
  /** DashboardConfig key of the status card badge. */
  badgeKey: "wowLiveLabel" | "wowToActivateLabel" | "wowAttentionLabel" | "wowOfflineLabel";
  /** DashboardConfig key of the status line, null when there is none. */
  lineKey:
    | "heroNoNumber"
    | "heroSubscriptionInactive"
    | "heroConfigUnavailable"
    | "heroEngineUnreachable"
    | null;
  /** The line's call to action, null when there is none. */
  action: HeroAction | null;
};

const HERO_STATES = {
  live: {
    status: "live",
    live: true,
    tone: "live",
    eyebrowStatusKey: "heroLive",
    badgeKey: "wowLiveLabel",
    lineKey: null,
    action: null,
  },
  to_activate: {
    status: "to_activate",
    live: false,
    tone: "neutral",
    eyebrowStatusKey: "heroToActivate",
    badgeKey: "wowToActivateLabel",
    lineKey: "heroNoNumber",
    action: "get_number",
  },
  "attention:subscription_inactive": {
    status: "attention",
    live: false,
    tone: "warning",
    eyebrowStatusKey: "heroAttention",
    badgeKey: "wowAttentionLabel",
    lineKey: "heroSubscriptionInactive",
    action: "plans",
  },
  "attention:config_unavailable": {
    status: "attention",
    live: false,
    tone: "warning",
    eyebrowStatusKey: "heroAttention",
    badgeKey: "wowAttentionLabel",
    lineKey: "heroConfigUnavailable",
    action: "support",
  },
  // Our side is down: grey, "offline", and nothing for the owner to do.
  "attention:engine_unreachable": {
    status: "attention",
    live: false,
    tone: "neutral",
    eyebrowStatusKey: "heroOffline",
    badgeKey: "wowOfflineLabel",
    lineKey: "heroEngineUnreachable",
    action: null,
  },
} as const satisfies Record<string, HeroLiveState>;

type HeroStateId = keyof typeof HERO_STATES;

/** The table row for a server agentState, or null when it isn't one we know. */
function rowFor(agentState: unknown): HeroStateId | null {
  if (!agentState || typeof agentState !== "object") return null;
  const { state, reason } = agentState as { state?: unknown; reason?: unknown };
  const id = state === "attention" ? `attention:${String(reason)}` : String(state);
  return Object.prototype.hasOwnProperty.call(HERO_STATES, id) ? (id as HeroStateId) : null;
}

export function heroLiveState({
  agentState,
  primaryPhone,
}: {
  /** stats.agentState (an AgentState); typed loosely because a payload may be older or newer than this build. */
  agentState?: unknown;
  primaryPhone: string | null | undefined;
}): HeroLiveState {
  const row = rowFor(agentState);
  if (row) return HERO_STATES[row];
  // Missing / unknown: today's number-based rule, never "attention".
  return primaryPhone?.trim() ? HERO_STATES.live : HERO_STATES.to_activate;
}
