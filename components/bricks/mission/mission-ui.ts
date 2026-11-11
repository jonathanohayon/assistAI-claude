// Mission brick (M2b) — pure helpers. Client-safe, no DB.
//
// - Campaign editor: three mission cards REPLACE the goal-preset picker one
//   for one. A card writes the campaign's existing `goalPreset` exactly as
//   before; an untouched campaign keeps its stored preset byte for byte.
// - Agent editor: one quiet control, the agent's default mission for new
//   campaigns, stored as { version, kind, cold } (lib/mission/store.ts).
//
// The success proof shown under a card is read-only (SALES_MISSION_TABLE),
// labelled as an estimate: no tool proves any of the three today. The
// "Not active yet" line reuses the Tools brick's reading (capabilityView)
// and words; it is display only: the server never refuses a mission whose
// capability is missing.

import type { GoalPreset } from "@/lib/campaigns/constants";
import { missionForPreset, presetForMission } from "@/lib/mission/adapters";
import {
  MISSION_VERSION,
  SALES_MISSIONS,
  SALES_MISSION_TABLE,
  type SalesMission,
  type SalesMissionProof,
} from "@/lib/mission/contract";
import type { CapabilityKey, EffectiveCapabilities, MissingPrerequisite } from "@/lib/tools/contract";

import { capabilityView } from "../tools/tools-ui";

/** What the screen holds: the agent GET's `mission` (null = never set). */
export interface ScreenMission {
  kind: SalesMission;
  cold: boolean;
}

/**
 * The cards offered today. book_for_seller and follow_up stay hidden until
 * M2d (no preset maps to them yet).
 */
export const MISSION_CARDS = ["qualify_lead", "announce_offer", "other"] as const satisfies readonly SalesMission[];
export type CardMission = (typeof MISSION_CARDS)[number];

const isCard = (k: unknown): k is CardMission => (MISSION_CARDS as readonly unknown[]).includes(k);

// ── Campaign editor: cards ↔ the campaign's goalPreset ──

/** A stored preset → the card it shows (lead_gen/cold → qualify_lead, sales/marketing → announce_offer, else other). */
export function cardForPreset(preset: string): { kind: CardMission; cold: boolean } {
  const m = missionForPreset(preset);
  return isCard(m.kind) ? { kind: m.kind, cold: m.cold } : { kind: "other", cold: false };
}

/**
 * The preset a pick writes. Picking what is already shown returns the
 * stored preset UNCHANGED (an untouched campaign never changes its preset,
 * even an unknown stored value). announce_offer keeps `marketing`.
 */
export function presetForCard(current: string, kind: CardMission, cold = false): GoalPreset | (string & {}) {
  const shown = cardForPreset(current);
  const wantCold = kind === "qualify_lead" && cold;
  if (shown.kind === kind && shown.cold === wantCold) return current;
  if (kind === "qualify_lead") return wantCold ? "cold" : "lead_gen";
  if (kind === "announce_offer") return current === "marketing" ? "marketing" : "sales";
  return "custom";
}

/** The read-only proof line's message key for a mission. */
export function proofOf(kind: SalesMission): SalesMissionProof {
  return SALES_MISSION_TABLE[kind].provenBy;
}

/** Whether the "cold prospecting" switch is shown for a card. */
export function takesCold(kind: SalesMission): boolean {
  return SALES_MISSION_TABLE[kind].allowsCold;
}

// ── Agent editor: the default mission for new campaigns ──

/** The agent GET's `mission` → the screen (anything unreadable = null, like the server). */
export function missionFromServed(served: unknown): ScreenMission | null {
  if (!served || typeof served !== "object") return null;
  const o = served as { kind?: unknown; cold?: unknown };
  if (!(SALES_MISSIONS as readonly unknown[]).includes(o.kind)) return null;
  const kind = o.kind as SalesMission;
  return { kind, cold: o.cold === true && SALES_MISSION_TABLE[kind].allowsCold };
}

/** The compact control's options (value = kind, or kind + ":cold"). */
export const DEFAULT_MISSION_OPTIONS = ["qualify_lead", "qualify_lead:cold", "announce_offer", "other"] as const;
export type DefaultMissionOption = (typeof DEFAULT_MISSION_OPTIONS)[number];

/**
 * The control's value for a stored mission. "" = none of the three: never
 * set, or a kind the cards don't offer yet (book_for_seller, follow_up) —
 * shown unselected, no error.
 */
export function defaultMissionValue(m: ScreenMission | null): DefaultMissionOption | "" {
  if (!m || !isCard(m.kind)) return "";
  if (m.kind === "qualify_lead") return m.cold ? "qualify_lead:cold" : "qualify_lead";
  return m.kind;
}

/** A picked option → the screen mission. */
export function missionForDefaultOption(v: DefaultMissionOption): ScreenMission {
  if (v === "qualify_lead:cold") return { kind: "qualify_lead", cold: true };
  return { kind: v, cold: false };
}

/**
 * The agent save body's mission part: `{}` when nothing changed (the server
 * keeps the stored value, whatever it is), else `{ mission }` — the whole
 * stored object, since the server replaces it, never merges.
 */
export function missionSaveBody(
  base: ScreenMission | null,
  next: ScreenMission | null,
): { mission?: { version: typeof MISSION_VERSION; kind: SalesMission; cold: boolean } | null } {
  const same = (base?.kind ?? null) === (next?.kind ?? null) && (base?.cold ?? false) === (next?.cold ?? false);
  if (same) return {};
  if (!next) return { mission: null };
  return { mission: { version: MISSION_VERSION, kind: next.kind, cold: takesCold(next.kind) && next.cold } };
}

/** A refused save: 400 invalid_mission → true (one generic line; the reasons are never shown). */
export function missionRefused(status: number, body: unknown): boolean {
  return status === 400 && (body as { error?: unknown } | null)?.error === "invalid_mission";
}

// ── "Not active yet" (the Tools brick's reading) ──

/** One capability the mission needs, and why it isn't active (the Tools brick's words). */
export interface MissionNeed {
  key: CapabilityKey;
  /** null = the switch is off (nothing missing on the account's side). */
  missing: MissingPrerequisite | null;
}

/**
 * The "Not active yet" lines for a mission, from the server's
 * effectiveCapabilities for the agent. Empty = nothing to say: every
 * required capability is on, the mission needs none, or the answer isn't
 * known (no agent, loading) — never a guess.
 *
 * - `all`: each one not on is listed;
 * - `anyOf`: listed only when NONE of them is on (one is enough);
 * - `optional`: never listed (used when active, never required).
 */
export function missionNeeds(kind: SalesMission | null, caps: EffectiveCapabilities | null | undefined): MissionNeed[] {
  if (!kind || !caps) return [];
  const { all, anyOf } = SALES_MISSION_TABLE[kind].requires;
  const need = (key: CapabilityKey): MissionNeed | null => {
    const s = caps[key];
    if (!s) return null;
    const v = capabilityView(key, s);
    return v.status === "on" ? null : { key, missing: v.missing };
  };
  const out: MissionNeed[] = [];
  for (const k of all) {
    const n = need(k);
    if (n) out.push(n);
  }
  if (anyOf.length > 0) {
    const missing = anyOf.map(need);
    if (missing.every((n) => n !== null)) out.push(...(missing as MissionNeed[]));
  }
  return out;
}

// ── A new campaign starts from its agent's default mission ──

/**
 * The preset a campaign draft takes when it picks an agent: the agent's
 * default (presetForMission, #282) for a NEW draft whose cards haven't been
 * touched; otherwise — an existing campaign, a card already picked, or no
 * mapping (no mission, book_for_seller, follow_up) — the current preset,
 * unchanged.
 */
export function presetOnAgentPick(opts: {
  isNew: boolean;
  cardPicked: boolean;
  current: string;
  agentMission: unknown;
}): string {
  if (!opts.isNew || opts.cardPicked) return opts.current;
  return presetForMission(missionFromServed(opts.agentMission)) ?? opts.current;
}
