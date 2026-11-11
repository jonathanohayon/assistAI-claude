// The Mission contract (brick M1): what the agent tries to achieve during a
// call, and how we know it succeeded. Pure, client-safe.
//
// M2a = the five SALES missions (SALES_MISSION_TABLE), today's presets read
// into them losslessly, and the mission stored on the outbound agent
// (lib/mission/store.ts) — nothing reads it for the instructions yet.
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

/**
 * The SALES missions of an outbound agent (M2a). Cold prospecting is NOT a
 * sixth mission: it is `qualify_lead` with `cold: true` (only the call's
 * opening changes).
 */
export const SALES_MISSIONS = ["qualify_lead", "book_for_seller", "announce_offer", "follow_up", "other"] as const;
export type SalesMission = (typeof SALES_MISSIONS)[number];

/** What proves a sales mission succeeded (measured by the TOOLS from M4b; not measured yet). */
export type SalesMissionProof =
  /** The lead sheet is saved with every required field. */
  | "lead_sheet_complete"
  /** A booking was created. */
  | "booking_created"
  /** A successful transfer, or a callback request. */
  | "transfer_or_callback"
  /** A booking or a transfer. */
  | "booking_or_transfer"
  /** Not measurable: the outcome is an estimate. */
  | "estimated";

export interface SalesMissionSpec {
  /**
   * Capabilities (lib/tools/contract.ts) the mission needs:
   * `all` = every one is required, `anyOf` = at least one of them,
   * `optional` = used when active, never required.
   */
  requires: { all: CapabilityKey[]; anyOf: CapabilityKey[]; optional: CapabilityKey[] };
  provenBy: SalesMissionProof;
  /** False = "estimated": no tool event can ever prove it. */
  measurable: boolean;
  /** Only `qualify_lead` takes the `cold` flag (cold prospecting). */
  allowsCold: boolean;
}

/** The five sales missions (tamaraVP spec, M2a). Pure data. */
export const SALES_MISSION_TABLE: Record<SalesMission, SalesMissionSpec> = {
  qualify_lead: {
    requires: { all: [], anyOf: [], optional: [] },
    provenBy: "lead_sheet_complete",
    measurable: true,
    allowsCold: true,
  },
  book_for_seller: {
    requires: { all: ["booking"], anyOf: [], optional: [] },
    provenBy: "booking_created",
    measurable: true,
    allowsCold: false,
  },
  announce_offer: {
    requires: { all: [], anyOf: [], optional: ["transfer"] },
    provenBy: "transfer_or_callback",
    measurable: true,
    allowsCold: false,
  },
  follow_up: {
    requires: { all: [], anyOf: ["booking", "transfer"], optional: [] },
    provenBy: "booking_or_transfer",
    measurable: true,
    allowsCold: false,
  },
  other: {
    requires: { all: [], anyOf: [], optional: [] },
    provenBy: "estimated",
    measurable: false,
    allowsCold: false,
  },
};

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
       * The sales mission (M2a). Read from today's preset by
       * missionFromCampaign (lossless: `preset` keeps the stored value);
       * null = no mission known.
       */
      kind: SalesMission | null;
      /** Cold prospecting: only with `qualify_lead` (changes the opening only). */
      cold: boolean;
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
