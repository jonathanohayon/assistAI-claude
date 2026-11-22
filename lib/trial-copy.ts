// Trial figures shown in the copy (Signup, Onboarding, Pricing), derived from
// the lib/trial.ts constants so no message ever hard-codes them. Pure module:
// safe to import from client components.
import { TRIAL_DURATION_MS, TRIAL_MINUTES_INCLUDED } from "@/lib/trial";

const DAY_MS = 24 * 60 * 60 * 1000;

/** ICU arguments for every trial message: `{days}` and `{minutes}`. */
export const TRIAL_COPY_VALUES: { days: number; minutes: number } = {
  days: Math.round(TRIAL_DURATION_MS / DAY_MS),
  minutes: TRIAL_MINUTES_INCLUDED,
};
