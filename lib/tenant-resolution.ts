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
