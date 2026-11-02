// Pure decision for /api/agent/config: which tenant path a request takes.
// Unit-tested in scripts/tests/tenant-resolution.test.ts.
//
// A dialed number with no phone_numbers row is refused. It used to fall back
// to resolveDefaultTenant(), which picks the first users⨝agent_configs row
// with no ORDER BY: an arbitrary customer's prompt and Google calendar served
// to a stranger's caller, silently.

export type TenantResolution =
  | "user_match"
  | "phone_match"
  | "unknown_number"
  | "default_fallback"
  | "no_id";

export function decideTenantResolution(args: {
  phone: string | null;
  userId: string | null;
  matched: boolean;
}): TenantResolution {
  const { phone, userId, matched } = args;
  if (userId) return matched ? "user_match" : "default_fallback";
  if (phone) return matched ? "phone_match" : "unknown_number";
  return "no_id";
}

/**
 * Tenant lookup shared by /api/calls/end and /api/whatsapp/notify, with the
 * DB lookups injected so it is unit-testable. A dialed number with no
 * phone_numbers row resolves to null: those routes used to fall back to the
 * default tenant, recording the call and sending WhatsApp recaps under an
 * arbitrary customer. The default tenant is only used when no number was
 * supplied at all (legacy callers).
 */
export async function resolveTenantWith<T>(
  phone: string | null,
  lookups: {
    byPhone: (phone: string) => Promise<T | null>;
    byDefault: () => Promise<T | null>;
  },
): Promise<T | null> {
  const dialed = (phone ?? "").trim();
  if (!dialed) return lookups.byDefault();
  return lookups.byPhone(dialed);
}
