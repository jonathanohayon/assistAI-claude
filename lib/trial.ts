// Constantes du free trial. Source unique de vérité — importée par signup,
// onboarding/provision (création / refresh du trial), le cron trial-cleanup
// (warning + suppression), et le dashboard layout (affichage countdown).

export const TRIAL_DURATION_MS = 24 * 60 * 60 * 1000; // 1 jour
export const TRIAL_WARNING_BEFORE_END_MS = 2 * 60 * 60 * 1000; // 2 heures
// Minimum time between the warning email and the account deletion. The
// trial-cleanup cron runs DAILY, so an "H-2" warning always landed in the same
// run as the deletion ("expire dans 0 min"): 5 prospects deleted with no usable
// warning (28/07 and 26/10/2026). The service itself is still cut at
// trialEndsAt by /api/agent/config; only the destructive step waits.
export const TRIAL_DELETION_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * An expired trial may be deleted only once its warning went out at least
 * TRIAL_DELETION_GRACE_MS ago. No warning, no deletion.
 */
export function isTrialDeletionDue(args: {
  trialEndsAt: Date | null;
  trialWarningSentAt: Date | null;
  now: Date;
}): boolean {
  const { trialEndsAt, trialWarningSentAt, now } = args;
  if (!trialEndsAt || trialEndsAt.getTime() > now.getTime()) return false;
  if (!trialWarningSentAt) return false;
  return now.getTime() - trialWarningSentAt.getTime() >= TRIAL_DELETION_GRACE_MS;
}

// Quota de minutes d'appels pour l'essai gratuit. Le service est coupé au
// PREMIER atteint : 60 min d'appels consommées OU 24h écoulées.
export const TRIAL_MINUTES_INCLUDED = 60;
export const TRIAL_SECONDS_LIMIT = TRIAL_MINUTES_INCLUDED * 60; // 3600

export function computeTrialEndsAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + TRIAL_DURATION_MS);
}

/**
 * Un essai est "épuisé" (service à couper) dès que l'une des deux limites est
 * franchie : 24h écoulées (trialEndsAt) OU 60 min d'appels consommées
 * (trialSecondsUsed). Ne s'applique qu'aux comptes `trialing` — un compte payé
 * ou expiré n'est jamais concerné. La suppression du compte/numéro à 24h reste
 * gérée par le cron trial-cleanup ; ce helper coupe le service en amont (ex:
 * 60 min atteintes avant la fin des 24h).
 */
export function isTrialExhausted(args: {
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  trialSecondsUsed: number;
  now?: Date;
}): boolean {
  if (args.subscriptionStatus !== "trialing") return false;
  const now = args.now ?? new Date();
  const timeUp = args.trialEndsAt
    ? now.getTime() >= args.trialEndsAt.getTime()
    : false;
  const minutesUp = args.trialSecondsUsed >= TRIAL_SECONDS_LIMIT;
  return timeUp || minutesUp;
}
