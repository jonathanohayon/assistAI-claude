// The tenant's own aitamara number for the "call us" line. SERVER-ONLY.

import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { phoneNumbers } from "@/lib/db/schema";

/**
 * `preferred` (the number the client called) when it belongs to the tenant,
 * else the tenant's first number, else null (no line is added).
 */
export async function tenantCallNumber(userId: string, preferred?: string | null): Promise<string | null> {
  const rows = await db
    .select({ phoneNumber: phoneNumbers.phoneNumber })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, userId))
    .orderBy(asc(phoneNumbers.createdAt));
  if (!rows.length) return null;
  if (preferred && rows.some((r) => r.phoneNumber === preferred)) return preferred;
  return rows[0].phoneNumber;
}
