// Multi-tenant resolver: maps a called phone number to the user that owns it,
// then loads their agent_config. An unknown dialed number is refused; the
// first tenant in the DB is only used when no number is supplied (LiveTestPanel calls /api/agent/config without
// a phone param) so single-user dev keeps working.

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs, phoneNumbers, users } from "@/lib/db/schema";
import { normalizeE164 } from "@/lib/phone-utils";
import { resolveTenantWith } from "@/lib/tenant-resolution";

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
  if (row) return row;

  // Back-compat for WhatsApp channel rows: WhatsApp phone_numbers are stored
  // with a literal `whatsapp:` prefix (e.g. `whatsapp:+972237647000`), but the
  // worker always strips the prefix before calling us. The exact-match lookup
  // above therefore misses those rows, so retry once against the prefixed
  // stored value. PSTN rows (plain E.164) are unaffected — they already match
  // on the first query. First-match-wins.
  const [waRow] = await db
    .select({ user: users, config: agentConfigs })
    .from(phoneNumbers)
    .innerJoin(users, eq(users.id, phoneNumbers.userId))
    .innerJoin(agentConfigs, eq(agentConfigs.userId, phoneNumbers.userId))
    .where(eq(phoneNumbers.phoneNumber, `whatsapp:${normalized}`))
    .limit(1);
  return waRow ?? null;
}

/**
 * Resolve a tenant directly by user id — used par le chemin web LiveTest
 * (Phase 2 LK routing) où on connaît l'auth.user.id mais on a pas de
 * numéro de téléphone : la room metadata transporte `{ source: "web",
 * userId }`, le worker fetch ici plutôt que via resolveTenantByPhone.
 */
export async function resolveTenantByUserId(
  userId: string,
): Promise<ResolvedTenant | null> {
  const [row] = await db
    .select({ user: users, config: agentConfigs })
    .from(users)
    .innerJoin(agentConfigs, eq(agentConfigs.userId, users.id))
    .where(eq(users.id, userId))
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
 * Combined resolver used by /api/calls/end and /api/whatsapp/notify.
 * A dialed number with no phone_numbers row returns null (refused); the
 * default tenant is only used when no number is supplied. See
 * resolveTenantWith in lib/tenant-resolution.ts.
 */
export async function resolveTenant(
  phone: string | null,
): Promise<ResolvedTenant | null> {
  const tenant = await resolveTenantWith(phone, {
    byPhone: resolveTenantByPhone,
    byDefault: resolveDefaultTenant,
  });
  if (!tenant && phone?.trim()) {
    console.warn(`[tenant] no phone_numbers row for ${phone}, refused`);
  }
  return tenant;
}
