// Campaign editor save rules (campaigns-workspace.tsx). Pure, client-safe.

/** Campaign field → DashboardCampaigns label key, for 409 pause_to_edit. */
export const PAUSE_TO_EDIT_LABELS: Record<string, string> = {
  name: "nameLabel",
  goalPreset: "goalLabel",
  objective: "objectiveLabel",
  agentId: "agentSelectLabel",
  fromNumber: "fromNumberLabel",
  successCriteria: "successCriteriaLabel",
  extractionSchema: "extractionTitle",
  concurrency: "concurrencyLabel",
  retryRules: "retryTitle",
  callWindow: "windowTitle",
};

/**
 * Fields from a 409 { error: "pause_to_edit", fields } body, or null when the
 * body is anything else. Unknown field names are kept (shown raw) rather
 * than hidden, so the user always sees why the save was refused.
 */
export function pauseToEditFields(body: unknown): string[] | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { error?: unknown; fields?: unknown };
  if (b.error !== "pause_to_edit") return null;
  return Array.isArray(b.fields) ? b.fields.map(String) : [];
}

export function pauseToEditLabels(fields: string[], t: (key: string) => string): string {
  return fields.map((f) => (PAUSE_TO_EDIT_LABELS[f] ? t(PAUSE_TO_EDIT_LABELS[f]) : f)).join(", ");
}

/** Snapshot of the draft as last loaded/saved; null = never saved. */
export function snapshot(draft: unknown): string {
  return JSON.stringify(draft);
}

export function isDraftDirty(draft: unknown, saved: string | null): boolean {
  return saved === null || snapshot(draft) !== saved;
}
