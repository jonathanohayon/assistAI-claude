// Account "developer mode" flag — pure body parsing (unit-tested).

export function parseDeveloperModeBody(
  raw: unknown,
): { ok: true; value: boolean } | { ok: false; error: "invalid_developer_mode" } {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>).developerMode : undefined;
  return typeof v === "boolean" ? { ok: true, value: v } : { ok: false, error: "invalid_developer_mode" };
}
