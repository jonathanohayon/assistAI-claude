// The Mission contract (brick M1): what the agent tries to achieve during a
// call, and how we know it succeeded. Pure, client-safe.
//
// M1 = contract + adapters, NO behaviour change:
//   - outbound: a campaign's goal (preset, objective, success criteria,
//     fields to capture) — the instructions are built from the Mission and
//     are byte-identical to before;
//   - receptionist: an IMPLICIT mission (nothing is added to its
//     instructions; making it explicit is M3, after a test call).
// Success is measured from what the TOOLS did (events), never from what the
// model says (lib/mission/measure.ts).

import type { ExtractionField, GoalPreset } from "@/lib/campaigns/constants";
import type { CapabilityKey } from "@/lib/tools/contract";

export const MISSION_VERSION = 1 as const;

export const RECEPTIONIST_MISSIONS = ["inform_and_book", "take_messages"] as const;
export type ReceptionistMission = (typeof RECEPTIONIST_MISSIONS)[number];

/** What the agent does when it can't succeed (level 2; stored only from M2). */
export type MissionFallback = "take_message" | "transfer" | "offer_callback";

export type Mission =
  | {
      version: typeof MISSION_VERSION;
      recipe: "receptionist";
      kind: ReceptionistMission;
      /** True while the mission is derived, not chosen (adds no text, M3 changes it). */
      implicit: true;
      successCriteria: string;
      capture: ExtractionField[];
      fallback: MissionFallback;
      /** Capabilities the mission needs (brick Tools): missing ones show "Not active yet". */
      requires: CapabilityKey[];
    }
  | {
      version: typeof MISSION_VERSION;
      recipe: "outbound";
      /**
       * The spec's sales missions (qualify a lead, book for a seller, follow
       * up) don't map 1:1 onto today's presets: null until M2 decides.
       */
      kind: null;
      /** Today's campaign goal preset — a GoalPreset; any other stored value is kept as is (lossless). */
      preset: GoalPreset | (string & {});
      objective: string;
      successCriteria: string;
      capture: ExtractionField[];
      fallback: MissionFallback | null;
      requires: CapabilityKey[];
    };

/** The outcome of one call against its mission. */
export type MissionOutcome =
  /** A tool event proves it (e.g. book_success). */
  | { status: "achieved"; by: string }
  /** No tool can prove this mission yet: today's measure stays (keywords / campaign analysis). */
  | { status: "not_measured" }
  /** The mission is measurable by tools and none fired. */
  | { status: "not_achieved" };
