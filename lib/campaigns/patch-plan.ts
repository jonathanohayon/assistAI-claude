// What a campaign PATCH may change, depending on the campaign's status. Pure
// (no I/O) so it is unit-tested (scripts/tests/campaign-patch-plan.test.ts).
//
// The workspace sends the WHOLE draft on every save, so a field only counts
// as "changed" when its normalized value differs from the stored one —
// otherwise every save of a running campaign would be refused.
//
// Rules (PM, 2026-11-10):
//   - draft / paused: every field is editable.
//   - running: the call window (hours, days, timezone, respectDnc) is
//     editable — the dispatcher re-reads it on every tick, so it applies on
//     the next tick; narrowing it only stops future dials. Any OTHER changed
//     structural field → 409 pause_to_edit, and nothing is applied.
//   - other statuses (completed…): no structural change → 409
//     campaign_not_editable.
//   - name is always editable.

import {
  normalizeCallWindow,
  normalizeConcurrency,
  normalizeExtractionSchema,
  normalizeGoalPreset,
  normalizeRetryRules,
} from "@/lib/campaigns/validate";

export const STRUCTURAL_FIELDS = [
  "goalPreset",
  "objective",
  "successCriteria",
  "agentId",
  "extractionSchema",
  "concurrency",
  "retryRules",
  "callWindow",
  "fromNumber",
] as const;
export type StructuralField = (typeof STRUCTURAL_FIELDS)[number];

/** Fields that may change while a campaign is running. */
export const LIVE_EDITABLE_FIELDS: readonly StructuralField[] = ["callWindow"];

const NORMALIZE: Record<StructuralField, (v: unknown) => unknown> = {
  goalPreset: normalizeGoalPreset,
  objective: (v) => (typeof v === "string" ? v.slice(0, 4000) : ""),
  successCriteria: (v) => (typeof v === "string" ? v.slice(0, 4000) : ""),
  agentId: (v) => (typeof v === "string" && v ? v : null),
  extractionSchema: normalizeExtractionSchema,
  concurrency: normalizeConcurrency,
  retryRules: normalizeRetryRules,
  callWindow: normalizeCallWindow,
  fromNumber: (v) => (typeof v === "string" ? v.trim() : ""),
};

/** A field present in the body that the route would ignore when absent/invalid. */
function present(field: StructuralField, body: Record<string, unknown>): boolean {
  const v = body[field];
  if (v === undefined) return false;
  // Same acceptance as before for the string fields: non-strings are ignored.
  if ((field === "objective" || field === "successCriteria" || field === "fromNumber") && typeof v !== "string")
    return false;
  if (field === "agentId" && v !== null && typeof v !== "string") return false;
  return true;
}

/** Order-insensitive for object keys, order-sensitive for arrays except days. */
function canon(field: StructuralField, v: unknown): string {
  if (field === "callWindow" && v && typeof v === "object") {
    const w = v as { days?: number[] };
    v = { ...w, days: [...(w.days ?? [])].sort((a, b) => a - b) };
  }
  if (field === "retryRules" && v && typeof v === "object") {
    const r = v as { retryOn?: string[] };
    v = { ...r, retryOn: [...(r.retryOn ?? [])].sort() };
  }
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );
}

export type PatchPlan =
  | { ok: true; changes: Partial<Record<StructuralField, unknown>> }
  | { ok: false; error: "pause_to_edit" | "campaign_not_editable"; fields: StructuralField[] };

export function planCampaignPatch(
  campaign: { status: string } & Partial<Record<StructuralField, unknown>>,
  body: Record<string, unknown>,
): PatchPlan {
  const changes: Partial<Record<StructuralField, unknown>> = {};
  for (const f of STRUCTURAL_FIELDS) {
    if (!present(f, body)) continue;
    const next = NORMALIZE[f](body[f]);
    const current = NORMALIZE[f](campaign[f]);
    if (canon(f, next) !== canon(f, current)) changes[f] = next;
  }
  const changed = Object.keys(changes) as StructuralField[];

  if (campaign.status === "draft" || campaign.status === "paused") return { ok: true, changes };

  if (campaign.status === "running") {
    const blocked = changed.filter((f) => !LIVE_EDITABLE_FIELDS.includes(f));
    if (blocked.length) return { ok: false, error: "pause_to_edit", fields: blocked };
    return { ok: true, changes };
  }

  if (changed.length) return { ok: false, error: "campaign_not_editable", fields: changed };
  return { ok: true, changes };
}
