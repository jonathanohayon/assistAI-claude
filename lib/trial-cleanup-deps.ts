// The outside effects of the trial-cleanup cron (app/api/cron/trial-cleanup),
// as one mutable object so the DB suite can inject mocks: the two trial
// e-mails, the Twilio number release, and the paid-account guard (so the
// suite can prove the selection queries exclude paid accounts on their own). The route always calls through this
// object; production never reassigns it. SERVER-ONLY.

import { sendTrialDeletedEmail, sendTrialWarningEmail } from "@/lib/email";
import { releaseAllTwilioNumbersFor } from "@/lib/release-user";
import { mayEmailTrialAccount } from "@/lib/trial-end-email";

export const trialCleanupDeps = {
  sendWarning: sendTrialWarningEmail,
  /** The "Tamara is paused" e-mail (historical name: sendTrialDeletedEmail). */
  sendPaused: sendTrialDeletedEmail,
  releaseNumbers: releaseAllTwilioNumbersFor,
  /** The last guard before every trial e-mail (lib/trial-end-email.ts). */
  mayEmail: mayEmailTrialAccount,
};
