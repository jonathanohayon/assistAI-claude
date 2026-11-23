// Trial figures shown in the copy (Signup, Onboarding, Pricing, the trial
// e-mails and the dashboard trial banner), derived from the lib/trial.ts
// constants so no message ever hard-codes them. Pure module: safe to import
// from client components.
import {
  TRIAL_DURATION_MS,
  TRIAL_MINUTES_INCLUDED,
  TRIAL_NUMBER_RELEASE_AFTER_MS,
  TRIAL_WARNING_BEFORE_END_MS,
} from "@/lib/trial";

const DAY_MS = 24 * 60 * 60 * 1000;

/** ICU arguments for every trial message: `{days}` and `{minutes}`. */
export const TRIAL_COPY_VALUES: { days: number; minutes: number } = {
  days: Math.round(TRIAL_DURATION_MS / DAY_MS),
  minutes: TRIAL_MINUTES_INCLUDED,
};

/**
 * ICU arguments for the end-of-trial copy (the warning e-mail, the paused
 * e-mail, the dashboard banner): `{warningDays}` = how long before the end the
 * warning goes out, `{retentionDays}` = how long a paused trial keeps its
 * number before the number is released (the account itself stays).
 */
export const TRIAL_END_COPY_VALUES: { warningDays: number; retentionDays: number } = {
  warningDays: Math.round(TRIAL_WARNING_BEFORE_END_MS / DAY_MS),
  retentionDays: Math.round(TRIAL_NUMBER_RELEASE_AFTER_MS / DAY_MS),
};
