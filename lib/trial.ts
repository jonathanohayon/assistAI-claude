// Constantes du free trial. Source unique de vérité — importée par signup,
// onboarding/provision (création / refresh du trial), le cron trial-cleanup
// (warning + pause + number release), et le dashboard layout (countdown).

// 2026-11 (Jonathan, via Fable's business report): 14 days / 100 min, and at
// the end the account is PAUSED, never deleted. A paused account keeps its
// data and its number; calls are refused (/api/agent/config 403
// trial_exhausted -> the worker hangs up). The number is released only after
// TRIAL_NUMBER_RELEASE_AFTER_MS paused; the account itself is never
// auto-deleted.
export const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
export const TRIAL_WARNING_BEFORE_END_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
export const TRIAL_PAUSED_STATUS = "trial_paused";
export const TRIAL_NUMBER_RELEASE_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days paused

/** An expired trial is paused (never deleted). Admins are never paused. */
export function isTrialPauseDue(args: {
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  role?: string | null;
  now: Date;
}): boolean {
  if (args.role === "admin" || args.subscriptionStatus !== "trialing") return false;
  return !!args.trialEndsAt && args.trialEndsAt.getTime() <= args.now.getTime();
}

/**
 * A paused trial's number is released 30 days after the trial ended (the
 * pause starts then). The account stays; only the number goes back.
 */
export function isTrialNumberReleaseDue(args: {
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  role?: string | null;
  now: Date;
}): boolean {
  if (args.role === "admin" || args.subscriptionStatus !== TRIAL_PAUSED_STATUS) return false;
  if (!args.trialEndsAt) return false;
  return args.now.getTime() - args.trialEndsAt.getTime() >= TRIAL_NUMBER_RELEASE_AFTER_MS;
}

// Quota de minutes d'appels pour l'essai gratuit. Le service est coupé au
// PREMIER atteint : 100 min d'appels consommées OU 14 jours écoulés.
export const TRIAL_MINUTES_INCLUDED = 100;
export const TRIAL_SECONDS_LIMIT = TRIAL_MINUTES_INCLUDED * 60; // 6000

/**
 * Whether the sign-up trial gate applies to this account: a trialing or
 * paused non-admin account. The billing display (lib/products-usage.ts) uses
 * this same predicate to show the trial cap.
 */
export function signupTrialGateApplies(user: { subscriptionStatus: string; role: string | null }): boolean {
  return (
    (user.subscriptionStatus === "trialing" || user.subscriptionStatus === TRIAL_PAUSED_STATUS) &&
    user.role !== "admin"
  );
}

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
/** Which trial limit refuses calls now (see trialExhaustionCause). */
export type TrialExhaustionCause = "time" | "minutes" | "paused";

/**
 * The ONE definition of "this trial refuses calls now", naming WHICH condition
 * refused: "paused" (status trial_paused), "time" (trialing, trialEndsAt
 * passed) or "minutes" (trialing, trialSecondsUsed >= TRIAL_SECONDS_LIMIT).
 * When both time and minutes are up, "time" wins. null = calls allowed:
 * admins, paid plans (no minutes refusal: overage) and trials within limits.
 */
export function trialExhaustionCause(args: {
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  trialSecondsUsed: number;
  /** Admins never run out: the admin account is `trialing` in prod. */
  role?: string | null;
  now?: Date;
}): TrialExhaustionCause | null {
  if (args.role === "admin") return null;
  // A paused trial (ended, not paid) refuses calls like an exhausted one.
  if (args.subscriptionStatus === TRIAL_PAUSED_STATUS) return "paused";
  if (args.subscriptionStatus !== "trialing") return null;
  const now = args.now ?? new Date();
  const timeUp = args.trialEndsAt
    ? now.getTime() >= args.trialEndsAt.getTime()
    : false;
  if (timeUp) return "time";
  if (args.trialSecondsUsed >= TRIAL_SECONDS_LIMIT) return "minutes";
  return null;
}

export function isTrialExhausted(args: {
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  trialSecondsUsed: number;
  /** Admins never run out: the admin account is `trialing` in prod. */
  role?: string | null;
  now?: Date;
}): boolean {
  return trialExhaustionCause(args) !== null;
}
