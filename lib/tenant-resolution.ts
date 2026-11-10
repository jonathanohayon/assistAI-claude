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
    /** Reported when the default tenant is used (A3: observation only). */
    onFallback?: (answered: T | null) => Promise<void> | void;
  },
): Promise<T | null> {
  const dialed = (phone ?? "").trim();
  if (!dialed) {
    const t = await lookups.byDefault();
    await lookups.onFallback?.(t);
    return t;
  }
  return lookups.byPhone(dialed);
}

// ── Default-tenant fallback: observation only (A3) ─────────────────────
// Every path that ends on resolveDefaultTenant() is reported LOUDLY (event
// at level error + one deduplicated admin alert). Behaviour is unchanged:
// refusing these cleanly is step A7, after a test call.

/** Which lookup missed before the default tenant answered. */
export type FallbackMiss = "user_id_not_found" | "no_identifier";

export interface TenantFallback {
  /** The route / call origin that fell back, e.g. "agent_config", "calls_end". */
  origin: string;
  missed: FallbackMiss;
  /** The userId that missed (an internal id, never a phone number). */
  missedUserId?: string | null;
  /** The account that answered instead, null if the DB has none. */
  answeredBy: string | null;
}

export type OnFallback = (f: TenantFallback) => Promise<void> | void;

/** Event + alert for a fallback. Pure; no caller phone number in either. */
export function tenantFallbackReport(f: TenantFallback) {
  const missed = f.missed === "user_id_not_found" ? `userId ${f.missedUserId ?? "?"} not found` : "no identifier sent";
  const answered = f.answeredBy ? `account ${f.answeredBy} answered` : "no account in the DB";
  return {
    event: {
      source: "tenant" as const,
      event: "tenant_fallback_used",
      message: `Default-tenant fallback on ${f.origin}: ${missed}; ${answered}`,
      level: "error" as const,
      metadata: { origin: f.origin, missed: f.missed, missedUserId: f.missedUserId ?? null, answeredBy: f.answeredBy },
    },
    alert: {
      key: `tenant_fallback:${f.origin}`,
      subject: `Default-tenant fallback used (${f.origin})`,
      body: `${missed}; ${answered}. A call may be served under the wrong account.`,
      dedupMs: 60 * 60 * 1000,
    },
  };
}

/**
 * Inbound tenant lookup of /api/agent/config, with the DB lookups injected:
 * userId first, else the called number; an unknown number is refused; any
 * other miss falls back to the default tenant (reported through onFallback).
 */
export async function resolveInboundTenantWith<T>(
  args: { origin: string; phone: string | null; userId: string | null },
  lookups: {
    byUserId: (userId: string) => Promise<T | null>;
    byPhone: (phone: string) => Promise<T | null>;
    byDefault: () => Promise<T | null>;
    accountId: (t: T) => string;
    onFallback: OnFallback;
  },
): Promise<{ resolution: TenantResolution; tenant: T | null }> {
  const { phone, userId } = args;
  let tenant = userId ? await lookups.byUserId(userId) : phone ? await lookups.byPhone(phone) : null;
  const resolution = decideTenantResolution({ phone, userId, matched: Boolean(tenant) });
  if (resolution === "unknown_number") return { resolution, tenant: null };
  if (!tenant) {
    tenant = await lookups.byDefault();
    await lookups.onFallback({
      origin: args.origin,
      missed: userId ? "user_id_not_found" : "no_identifier",
      missedUserId: userId,
      answeredBy: tenant ? lookups.accountId(tenant) : null,
    });
  }
  return { resolution, tenant };
}
