/**
 * Normalisation des numéros de téléphone — source unique de vérité.
 *
 * Trois niveaux de normalisation coexistent dans l'app, chacun pour un
 * usage précis. NE PAS les mélanger :
 *
 * 1. `normalizeE164` — affichage / envoi (permissif).
 *    Nettoie une saisie « raisonnable » (espaces, parenthèses, tirets,
 *    préfixe `whatsapp:`) et garantit un `+` en tête. Ne VALIDE PAS le
 *    numéro : "abc" devient "+abc". À utiliser quand le numéro vient
 *    d'une source déjà fiable (DB, Twilio, worker) et qu'on veut juste
 *    un format homogène pour matcher / envoyer.
 *
 * 2. `normalizePhoneStrict` — validation stricte (import de contacts).
 *    Vérifie le format E.164 (regex) et renvoie `null` si le numéro est
 *    irrécupérable ou ambigu (pas d'indicatif pays). À utiliser sur
 *    toute saisie utilisateur brute (CSV de campagne, formulaires).
 *
 * 3. `normalizePhoneForDedup` — clé de dédoublonnage (digits only).
 *    Réduit le numéro à ses chiffres pour matcher "0585001007" et
 *    "058 500 10 07" comme la même clé. N'altère JAMAIS la valeur
 *    stockée — uniquement pour la comparaison (Google Sheets, CRM).
 *
 * Fichier CLIENT-SAFE : aucune dépendance serveur (db, env…), il peut
 * être importé depuis l'UI comme depuis les routes API.
 */

// E.164 : "+" puis 8 à 15 chiffres (premier chiffre non nul).
const E164_RE = /^\+[1-9]\d{7,14}$/;

/**
 * Normalisation permissive vers un format E.164 « de bonne foi ».
 * Strip le préfixe `whatsapp:`, retire espaces/parenthèses/tirets et
 * préfixe `+` si absent. Ne valide pas — voir `normalizePhoneStrict`
 * pour la validation stricte des saisies utilisateur.
 */
export const normalizeE164 = (number: string): string => {
  const trimmed = number.trim();
  const stripped = trimmed.replace(/^whatsapp:/, "").replace(/[\s()-]/g, "");
  return stripped.startsWith("+") ? stripped : `+${stripped}`;
};

/**
 * Normalise une saisie utilisateur en E.164 si possible. Renvoie null si
 * irrécupérable. Gère : espaces, tirets, points, parenthèses, "00" → "+".
 * Un numéro sans "+" ni "00" est rejeté (on ne devine pas l'indicatif pays).
 */
export function normalizePhoneStrict(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/[\s\-.()/]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  // Pas de "+" mais que des chiffres → on ne devine pas l'indicatif pays.
  if (!s.startsWith("+")) {
    if (/^\d+$/.test(s)) return null; // ambigu, rejet explicite
    return null;
  }
  if (!E164_RE.test(s)) return null;
  return s;
}

/**
 * Normalise un numéro pour le dédoublonnage (digits only). N'altère PAS la
 * valeur stockée — sert uniquement à matcher "0585001007" et
 * "058 500 10 07" comme la même clé.
 */
export const normalizePhoneForDedup = (phone: string): string =>
  (phone ?? "").replace(/[^\d]/g, "");
