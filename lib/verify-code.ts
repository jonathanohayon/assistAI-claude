// Génération + validation de codes de vérification email à 4 chiffres.
//
// Sécurité :
//   - Le code en clair n'est jamais stocké : bcrypt hash en DB.
//   - Rate-limit : MAX_ATTEMPTS = 5 par code, après quoi il faut "resend".
//   - Expiration : 15min après création. Au-delà, considéré invalide.
//   - Throttling resend : MIN_RESEND_INTERVAL_MS = 60s entre 2 emails.
//   - Les anciens codes non consumés sont marqués consumed à chaque
//     nouvelle génération → un seul code actif par user à la fois.

import bcrypt from "bcryptjs";
import { and, desc, eq, isNull, sql as drizzleSql } from "drizzle-orm";

import { db } from "@/lib/db";
import { emailVerifications, users } from "@/lib/db/schema";

const CODE_LENGTH = 4;
const CODE_TTL_MS = 15 * 60 * 1000; // 15min
const MAX_ATTEMPTS = 5;
const MIN_RESEND_INTERVAL_MS = 60 * 1000; // 60s

/**
 * 4 chiffres aléatoires sécurisés via crypto.getRandomValues. Évite le
 * biais modulo (Math.floor(Math.random() * 10000) est crypto-faible).
 */
const generateCode = (): string => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // 10000 valeurs → 4 chiffres : on prend modulo 10000 puis pad.
  // Le biais modulo est négligeable ici (2^32 / 10000 ≈ 429496, quasi
  // multiple parfait), pour ce niveau de sécurité (anti-bot retail) c'est OK.
  const n = (buf[0] ?? 0) % 10 ** CODE_LENGTH;
  return n.toString().padStart(CODE_LENGTH, "0");
};

export interface CreateResult {
  ok: boolean;
  code?: string;
  cooldownSeconds?: number;
  reason?: string;
}

/**
 * Crée un nouveau code de vérif pour ce user, en désactivant les éventuels
 * précédents non-consumés. Retourne le code EN CLAIR (à envoyer par email),
 * jamais persisté tel quel.
 *
 * Si un code récent (<60s) existe, retourne `cooldownSeconds` au lieu d'en
 * générer un nouveau — évite le spam mail si le user tape vite.
 */
export async function createEmailVerification(
  userId: string,
  options: { skipCooldown?: boolean } = {},
): Promise<CreateResult> {
  // Vérifie le throttle resend.
  if (!options.skipCooldown) {
    const [recent] = await db
      .select({ createdAt: emailVerifications.createdAt })
      .from(emailVerifications)
      .where(eq(emailVerifications.userId, userId))
      .orderBy(desc(emailVerifications.createdAt))
      .limit(1);
    if (recent) {
      const elapsed = Date.now() - new Date(recent.createdAt).getTime();
      if (elapsed < MIN_RESEND_INTERVAL_MS) {
        return {
          ok: false,
          reason: "cooldown",
          cooldownSeconds: Math.ceil(
            (MIN_RESEND_INTERVAL_MS - elapsed) / 1000,
          ),
        };
      }
    }
  }

  // Mark old non-consumed codes as consumed → 1 seul code actif à la fois.
  await db
    .update(emailVerifications)
    .set({ consumedAt: drizzleSql`now()` })
    .where(
      and(
        eq(emailVerifications.userId, userId),
        isNull(emailVerifications.consumedAt),
      ),
    );

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await db.insert(emailVerifications).values({
    userId,
    codeHash,
    expiresAt,
    attempts: 0,
  });

  return { ok: true, code };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "no_code" | "expired" | "max_attempts" | "wrong_code"; attemptsLeft?: number };

/**
 * Vérifie le code saisi par le user. Si correct : marque users.email_verified
 * = true ET le code comme consumed. Si faux : incrémente attempts. Au-delà
 * de MAX_ATTEMPTS, le code est consumed (le user doit resend).
 */
export async function verifyEmailCode(
  userId: string,
  code: string,
): Promise<VerifyResult> {
  const cleaned = (code ?? "").trim();
  if (cleaned.length !== CODE_LENGTH || !/^\d+$/.test(cleaned)) {
    return { ok: false, reason: "wrong_code" };
  }

  // Récupère le dernier code non-consumé du user.
  const [active] = await db
    .select()
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.userId, userId),
        isNull(emailVerifications.consumedAt),
      ),
    )
    .orderBy(desc(emailVerifications.createdAt))
    .limit(1);

  if (!active) {
    return { ok: false, reason: "no_code" };
  }

  if (new Date(active.expiresAt).getTime() < Date.now()) {
    // Marque expired comme consumed pour pas qu'il traîne.
    await db
      .update(emailVerifications)
      .set({ consumedAt: drizzleSql`now()` })
      .where(eq(emailVerifications.id, active.id));
    return { ok: false, reason: "expired" };
  }

  if (active.attempts >= MAX_ATTEMPTS) {
    await db
      .update(emailVerifications)
      .set({ consumedAt: drizzleSql`now()` })
      .where(eq(emailVerifications.id, active.id));
    return { ok: false, reason: "max_attempts" };
  }

  const ok = await bcrypt.compare(cleaned, active.codeHash);
  if (!ok) {
    const newAttempts = active.attempts + 1;
    await db
      .update(emailVerifications)
      .set({ attempts: newAttempts })
      .where(eq(emailVerifications.id, active.id));
    return {
      ok: false,
      reason: "wrong_code",
      attemptsLeft: MAX_ATTEMPTS - newAttempts,
    };
  }

  // Succès : marque le code comme consumed + flag user.
  await db
    .update(emailVerifications)
    .set({ consumedAt: drizzleSql`now()` })
    .where(eq(emailVerifications.id, active.id));
  await db
    .update(users)
    .set({ emailVerified: true })
    .where(eq(users.id, userId));

  return { ok: true };
}
