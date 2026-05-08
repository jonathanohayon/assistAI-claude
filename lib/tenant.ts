// Multi-tenant resolver: maps a called phone number to the user that owns it,
// then loads their agent_config. Falls back to the first tenant in the DB
// when no number is supplied (LiveTestPanel calls /api/agent/config without
// a phone param) so single-user dev keeps working.

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs, phoneNumbers, users } from "@/lib/db/schema";

const normalizeE164 = (input: string): string => {
  const trimmed = input.trim();
  const stripped = trimmed.replace(/^whatsapp:/, "").replace(/[\s()-]/g, "");
  return stripped.startsWith("+") ? stripped : `+${stripped}`;
};

export interface ResolvedTenant {
  user: typeof users.$inferSelect;
  config: typeof agentConfigs.$inferSelect;
}

/** Resolve the tenant whose phone number was dialed. */
export async function resolveTenantByPhone(
  phone: string,
): Promise<ResolvedTenant | null> {
  const normalized = normalizeE164(phone);
  const [row] = await db
    .select({ user: users, config: agentConfigs })
    .from(phoneNumbers)
    .innerJoin(users, eq(users.id, phoneNumbers.userId))
    .innerJoin(agentConfigs, eq(agentConfigs.userId, phoneNumbers.userId))
    .where(eq(phoneNumbers.phoneNumber, normalized))
    .limit(1);
  return row ?? null;
}

/**
 * Phase-1 fallback: pick the first user/config in the DB. Used by the live
 * test panel and any agent dispatch where the called number couldn't be
 * extracted from LiveKit metadata.
 */
export async function resolveDefaultTenant(): Promise<ResolvedTenant | null> {
  const [row] = await db
    .select({ user: users, config: agentConfigs })
    .from(users)
    .innerJoin(agentConfigs, eq(agentConfigs.userId, users.id))
    .limit(1);
  return row ?? null;
}

/**
 * Combined resolver: try phone routing first, fall back to default tenant.
 * Logs the chosen path for observability.
 */
export async function resolveTenant(
  phone: string | null,
): Promise<ResolvedTenant | null> {
  if (phone) {
    const matched = await resolveTenantByPhone(phone);
    if (matched) return matched;
    console.warn(
      `[tenant] no phone_number row for ${phone}, falling back to default`,
    );
  }
  return resolveDefaultTenant();
}
