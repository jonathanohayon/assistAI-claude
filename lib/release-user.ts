import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { phoneNumbers, users } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { releaseNumber } from "@/lib/twilio-numbers";

export interface ReleaseSummary {
  releasedCount: number;
  failedCount: number;
  errors: string[];
}

/**
 * Libère TOUS les numéros Twilio d'un user avant de delete sa row DB.
 * Best-effort : continue même si Twilio renvoie une erreur (le user est
 * supprimé quand même côté DB, l'admin sera juste alerté qu'un release
 * a échoué pour audit manuel).
 *
 * À appeler AVANT le `db.delete(users)` parce que la cascade DB supprime
 * les phone_numbers rows et on perd la liste des SID Twilio à libérer.
 */
export async function releaseAllTwilioNumbersFor(
  userId: string,
): Promise<ReleaseSummary> {
  const summary: ReleaseSummary = {
    releasedCount: 0,
    failedCount: 0,
    errors: [],
  };

  const numbers = await db
    .select({
      id: phoneNumbers.id,
      phoneNumber: phoneNumbers.phoneNumber,
      twilioSid: phoneNumbers.twilioSid,
    })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, userId));

  for (const n of numbers) {
    if (!n.twilioSid) {
      // Numéro mappé manuellement (ex: admin restore) sans SID Twilio
      // → rien à libérer côté Twilio, on skip.
      continue;
    }
    try {
      await releaseNumber(n.twilioSid);
      summary.releasedCount++;
      await logEvent({
        source: "web",
        event: "twilio_number_released",
        message: `Numéro ${n.phoneNumber} libéré côté Twilio (SID ${n.twilioSid})`,
        userId,
        metadata: { phoneNumber: n.phoneNumber, sid: n.twilioSid },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "release failed";
      summary.failedCount++;
      summary.errors.push(`${n.phoneNumber}: ${msg}`);
      await logEvent({
        source: "web",
        event: "twilio_number_release_failed",
        message: `Échec libération ${n.phoneNumber} : ${msg.slice(0, 200)}`,
        level: "error",
        userId,
        metadata: { phoneNumber: n.phoneNumber, sid: n.twilioSid, error: msg },
      });
    }
  }

  return summary;
}

/**
 * Suppression complète d'un tenant : libère ses numéros Twilio puis
 * delete la row users. Cascade DB nettoie agent_configs / calls /
 * phone_numbers / verifications. Events.userId set null (audit kept).
 *
 * Retourne le résumé (release count + DB delete OK).
 */
export async function fullyDeleteUser(userId: string): Promise<{
  release: ReleaseSummary;
  email: string | null;
}> {
  const [target] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) {
    return { release: { releasedCount: 0, failedCount: 0, errors: [] }, email: null };
  }
  // 1. Libère Twilio AVANT le DB delete (sinon les rows phone_numbers
  // disparaissent en cascade et on perd les SID).
  const release = await releaseAllTwilioNumbersFor(userId);
  // 2. Delete user (cascade nettoie tout le reste côté DB).
  await db.delete(users).where(eq(users.id, userId));
  return { release, email: target.email };
}
