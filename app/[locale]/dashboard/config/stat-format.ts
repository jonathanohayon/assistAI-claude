/**
 * Pure helpers for the dashboard hero stats. Units are not formatted here:
 * the numbers go into ICU messages (DashboardConfig.stat*Value) so each
 * locale places the unit itself (Hebrew: number first, then "דק׳").
 */

/** Average call length split for the statDurationValue message; null when no call. */
export function splitDuration(avgSeconds: number): { min: number; sec: number } | null {
  const s = Math.round(avgSeconds);
  if (!Number.isFinite(s) || s <= 0) return null;
  return { min: Math.floor(s / 60), sec: s % 60 };
}
