/**
 * Petits utilitaires numériques partagés.
 */

/** Borne `value` dans l'intervalle [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
