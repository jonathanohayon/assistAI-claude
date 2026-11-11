import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { phoneNumbers } from "@/lib/db/schema";

// The tenant's default caller-id = its OLDEST number (first one provisioned).
// Shared by every route that needs "the tenant's number" (call-me, campaign
// test call) so they always dial from the same line. Without the ORDER BY,
// Postgres returns an arbitrary row when the tenant owns several numbers.

type Database = Pick<typeof db, "select">;

export function oldestTenantNumberQuery(userId: string, database: Database = db) {
  return database
    .select({ phoneNumber: phoneNumbers.phoneNumber })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, userId))
    .orderBy(asc(phoneNumbers.createdAt), asc(phoneNumbers.id))
    .limit(1);
}

// The oldest number's E.164, or null when the tenant has none.
export async function oldestTenantNumber(userId: string, database: Database = db): Promise<string | null> {
  const [row] = await oldestTenantNumberQuery(userId, database);
  return row?.phoneNumber ?? null;
}
