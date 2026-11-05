// Client profile lookup for the voice agent (loyalty v1) — SERVER-ONLY.

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { clientVisits } from "@/lib/db/schema";
import { buildClientProfile, clientPhoneKey, type ClientProfile } from "@/lib/loyalty";

export const CLIENT_PROFILE_TIMEOUT_MS = 300;

/**
 * Profile of the caller for this tenant, or null (unknown caller, no
 * bookings, no Calendar, slow DB). Never throws and never takes more than
 * `timeoutMs`: the call must start the same with or without it.
 */
export async function getClientProfile(
  userId: string,
  callerRaw: string | null | undefined,
  timeoutMs = CLIENT_PROFILE_TIMEOUT_MS,
): Promise<ClientProfile | null> {
  const phone = clientPhoneKey(callerRaw);
  if (!phone) return null;
  const lookup = db
    .select({
      clientName: clientVisits.clientName,
      startsAt: clientVisits.startsAt,
      cancelled: clientVisits.cancelled,
    })
    .from(clientVisits)
    .where(and(eq(clientVisits.userId, userId), eq(clientVisits.clientPhone, phone)))
    .then((rows) => buildClientProfile(rows, new Date()))
    .catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([lookup, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
