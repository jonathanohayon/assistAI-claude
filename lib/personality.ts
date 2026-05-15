// Personality config — 9 dimensions, integer 1-10 each.
// Used by both /api/dashboard/config and /api/admin/configs/[userId].
//
// Pattern projet "tolérant" : on strip silencieusement les clés inconnues
// et les valeurs hors range plutôt que de renvoyer 400. Le front peut
// envoyer un objet partiel — seules les clés whitelistées avec valeurs
// numériques valides sont conservées.

export const PERSONALITY_KEYS = [
  "joie",
  "empathie",
  "dynamisme",
  "vitesse",
  "creativite",
  "humour",
  "professionnel",
  "reactivite",
  "accent",
] as const;

export type PersonalityKey = (typeof PERSONALITY_KEYS)[number];
export type Personality = Partial<Record<PersonalityKey, number>>;

const WHITELIST = new Set<string>(PERSONALITY_KEYS);

/**
 * Sanitize an arbitrary input into a personality object.
 * - Returns `undefined` if input is not a plain object (= "ne pas modifier").
 * - Returns `{}` if input is an empty object (= reset).
 * - Drops unknown keys.
 * - Drops non-numeric / NaN / non-finite values.
 * - Clamps + rounds valid numbers into [1, 10].
 */
export function sanitizePersonality(
  input: unknown,
): Record<string, number> | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    return undefined;
  }

  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!WHITELIST.has(key)) continue;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) continue;
    out[key] = Math.min(10, Math.max(1, Math.round(n)));
  }
  return out;
}
