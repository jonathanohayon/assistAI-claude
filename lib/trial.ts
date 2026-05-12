// Constantes du free trial. Source unique de vérité — importée par signup,
// onboarding/provision (création / refresh du trial), le cron trial-cleanup
// (warning + suppression), et le dashboard layout (affichage countdown).

export const TRIAL_DURATION_MS = 24 * 60 * 60 * 1000; // 1 jour
export const TRIAL_WARNING_BEFORE_END_MS = 2 * 60 * 60 * 1000; // 2 heures

export function computeTrialEndsAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + TRIAL_DURATION_MS);
}
