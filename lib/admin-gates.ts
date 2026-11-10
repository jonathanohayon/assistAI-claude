// Account-level admin-only settings (pure). Same rule as the voice/persona
// gates: a tenant CHANGING the value → 403 admin_only; saving other fields, or
// re-sending the value unchanged, passes; stored values are never migrated.

/**
 * inheritAdminGlobals (whether the per-plan admin directives apply). Product
 * change 11/11: tenants can no longer change it; existing values are kept
 * (a tenant who turned inheritance off stays off).
 */
export function inheritAdminGlobalsWrite(
  body: { inheritAdminGlobals?: unknown },
  current: boolean,
  isAdmin: boolean,
): { ok: true; value: boolean | undefined } | { ok: false; error: "admin_only"; fields: ["inheritAdminGlobals"] } {
  if (body.inheritAdminGlobals == null) return { ok: true, value: undefined };
  const next = Boolean(body.inheritAdminGlobals);
  if (!isAdmin && next !== current) return { ok: false, error: "admin_only", fields: ["inheritAdminGlobals"] };
  return { ok: true, value: next };
}
