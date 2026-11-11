// Today's settings → the Mission contract (M1), and back to the inputs the
// instruction builders take today. Pure.
import type { ExtractionField } from "@/lib/campaigns/constants";
import { MISSION_VERSION, type Mission } from "@/lib/mission/contract";
import type { EffectiveCapabilities } from "@/lib/tools/contract";

type OutboundMission = Extract<Mission, { recipe: "outbound" }>;

/** A campaign's goal (campaigns row). */
export function missionFromCampaign(c: {
  goalPreset: string;
  objective: string;
  successCriteria: string;
  extractionSchema: ExtractionField[] | null | undefined;
}): OutboundMission {
  return {
    version: MISSION_VERSION,
    recipe: "outbound",
    kind: null,
    preset: c.goalPreset,
    objective: c.objective,
    successCriteria: c.successCriteria,
    capture: c.extractionSchema ?? [],
    fallback: null,
    requires: [],
  };
}

/** An outbound agent's live test (no campaign): what the test route has always used. */
export const OUTBOUND_TEST_MISSION: OutboundMission = {
  version: MISSION_VERSION,
  recipe: "outbound",
  kind: null,
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
