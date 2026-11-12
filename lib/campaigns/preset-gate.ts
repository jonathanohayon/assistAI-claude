// Server gate on a campaign's goal preset (M2d). Pure (no I/O): the routes
// pass the booking check as a loader, so it only queries when needed, and
// scripts/tests/campaign-preset-gate.test.ts runs the same code.
//
// Two rules, checked on campaign create (POST /api/dashboard/campaigns) and
// patch (PATCH /api/dashboard/campaigns/[id]):
//   1. ADMIN-ONLY presets (book_for_seller, follow_up): a tenant CHANGING
//      the preset to one of them → 403 preset_admin_only. An unchanged
//      re-send passes (an admin may have set it), as does a save that omits
//      goalPreset (the stored value is kept).
//   2. book_for_seller needs booking to be EFFECTIVE for the campaign's
//      agent — caps.booking.active from effectiveCapabilities (the same
//      value the outbound call gets, lib/agent/session-config/campaign.ts).
//      Checked when the preset or the agent changes, for admins too: it is
//      a capability fact, not a permission → 403 capability_missing (same
//      status as the other capability refusals: outbound_tools_disabled,
//      client_agent_disabled).

import type { GoalPreset } from "@/lib/campaigns/constants";
import { normalizeGoalPreset } from "@/lib/campaigns/validate";

export const ADMIN_ONLY_PRESETS: readonly GoalPreset[] = ["book_for_seller", "follow_up"];

export type PresetRefusal =
  | { status: 403; body: { error: "preset_admin_only"; field: "goalPreset" } }
  | { status: 403; body: { error: "capability_missing"; field: "goalPreset"; capability: "booking" } };

/** The preset a CREATE stores: absent / unknown → "custom" (never an admin-only preset). */
export function createGoalPreset(body: Record<string, unknown>): GoalPreset {
  return normalizeGoalPreset(body.goalPreset);
}

/**
 * A PATCH: what the gate checks, from the stored campaign and the patch
 * plan's changes (planCampaignPatch). `resolvedAgentId` is the agent the
 * route will write when agentId changes (ownership-checked, null = detach).
 * Omitting goalPreset keeps the stored value.
 */
export function patchPresetGateInput(
  campaign: { goalPreset: string; agentId: string | null },
  changes: Partial<Record<string, unknown>>,
  resolvedAgentId: string | null,
): { preset: string; presetChanged: boolean; agentChanged: boolean; agentId: string | null } {
  const presetChanged = "goalPreset" in changes;
  const agentChanged = "agentId" in changes;
  return {
    preset: presetChanged ? String(changes.goalPreset) : campaign.goalPreset,
    presetChanged,
    agentChanged,
    agentId: agentChanged ? resolvedAgentId : campaign.agentId,
  };
}

export async function presetGateRefusal(args: {
  /** The preset that will be stored after this save. */
  preset: string;
  /** The save sets a NEW preset (create: always; patch: goalPreset in the plan's changes). */
  presetChanged: boolean;
  /** The save changes the campaign's agent (patch: agentId in the plan's changes). */
  agentChanged: boolean;
  /** The signed-in user is an admin (?asUserId included). */
  isAdmin: boolean;
  /** Booking is effective for the agent the campaign will have. Only called when needed. */
  bookingActive: () => Promise<boolean>;
}): Promise<PresetRefusal | null> {
  const { preset, presetChanged, agentChanged, isAdmin } = args;
  if (presetChanged && !isAdmin && (ADMIN_ONLY_PRESETS as readonly string[]).includes(preset)) {
    return { status: 403, body: { error: "preset_admin_only", field: "goalPreset" } };
  }
  if (preset === "book_for_seller" && (presetChanged || agentChanged) && !(await args.bookingActive())) {
    return { status: 403, body: { error: "capability_missing", field: "goalPreset", capability: "booking" } };
  }
  return null;
}
