// Today's settings → the Mission contract (M1), and back to the inputs the
// instruction builders take today. Pure.
import type { ExtractionField, GoalPreset } from "@/lib/campaigns/constants";
import { MISSION_VERSION, SALES_MISSION_TABLE, type Mission, type SalesMission } from "@/lib/mission/contract";
import type { EffectiveCapabilities } from "@/lib/tools/contract";

type OutboundMission = Extract<Mission, { recipe: "outbound" }>;

/**
 * Today's goal presets → the sales missions (M2a, mapping to confirm by
 * tamaraVP). Cold prospecting = qualify_lead + cold.
 */
export const PRESET_TO_MISSION: Record<GoalPreset, { kind: SalesMission; cold: boolean }> = {
  cold: { kind: "qualify_lead", cold: true },
  lead_gen: { kind: "qualify_lead", cold: false },
  sales: { kind: "announce_offer", cold: false },
  marketing: { kind: "announce_offer", cold: false },
  custom: { kind: "other", cold: false },
};

/** A stored preset → its mission; any other stored string → "other" (the raw preset is kept by the caller). */
export function missionForPreset(preset: string): { kind: SalesMission; cold: boolean } {
  return Object.prototype.hasOwnProperty.call(PRESET_TO_MISSION, preset)
    ? PRESET_TO_MISSION[preset as GoalPreset]
    : { kind: "other", cold: false };
}

/**
 * The reverse: an agent's default mission → the preset that prefills a NEW
 * campaign's draft (the front calls it; nothing server-side does yet).
 * Lossy by design, read side only: "marketing" reads as announce_offer and
 * comes back as "sales". book_for_seller and follow_up have no preset yet
 * (mapping pending tamaraVP) → null, as is a missing mission.
 */
export function presetForMission(m: { kind: SalesMission; cold: boolean } | null): GoalPreset | null {
  if (!m) return null;
  switch (m.kind) {
    case "qualify_lead":
      return m.cold ? "cold" : "lead_gen";
    case "announce_offer":
      return "sales";
    case "other":
      return "custom";
    case "book_for_seller":
    case "follow_up":
      return null;
  }
}

/** A campaign's goal (campaigns row). */
export function missionFromCampaign(c: {
  goalPreset: string;
  objective: string;
  successCriteria: string;
  extractionSchema: ExtractionField[] | null | undefined;
}): OutboundMission {
  const { kind, cold } = missionForPreset(c.goalPreset);
  return {
    version: MISSION_VERSION,
    recipe: "outbound",
    kind,
    cold,
    // The raw stored value, so nothing is lost (an unknown preset stays as is).
    preset: c.goalPreset,
    objective: c.objective,
    successCriteria: c.successCriteria,
    capture: c.extractionSchema ?? [],
    fallback: null,
    // The capabilities every mapped mission strictly needs: none of today's
    // presets maps to one that requires a capability.
    requires: [...SALES_MISSION_TABLE[kind].requires.all],
  };
}

/** An outbound agent's live test (no campaign): what the test route has always used. */
export const OUTBOUND_TEST_MISSION: OutboundMission = {
  version: MISSION_VERSION,
  recipe: "outbound",
  // Same reading as a "sales" campaign (PRESET_TO_MISSION).
  kind: "announce_offer",
  cold: false,
  preset: "sales",
  objective: "",
  successCriteria: "",
  capture: [],
  fallback: null,
  requires: [],
};

/**
 * The receptionist's IMPLICIT mission: inform and book when booking is
 * active on its calls, else take messages. Adds nothing to its instructions.
 */
export function receptionistMission(caps: EffectiveCapabilities): Extract<Mission, { recipe: "receptionist" }> {
  const booking = caps.booking.active;
  return {
    version: MISSION_VERSION,
    recipe: "receptionist",
    kind: booking ? "inform_and_book" : "take_messages",
    implicit: true,
    successCriteria: "",
    capture: [],
    fallback: "take_message",
    requires: booking ? ["booking"] : [],
  };
}

/** Mission → the goal fields buildCampaignInstructions takes (lib/campaigns/prompt.ts). */
export function campaignGoalFields(m: OutboundMission): { goalPreset: string; objective: string; successCriteria: string } {
  return { goalPreset: m.preset, objective: m.objective, successCriteria: m.successCriteria };
}
