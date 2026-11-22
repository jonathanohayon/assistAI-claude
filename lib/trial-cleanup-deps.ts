// The outside effects of the trial-cleanup cron (app/api/cron/trial-cleanup),
// as one mutable object so the DB suite can inject mocks: the two trial
// e-mails and the Twilio number release. The route always calls through this
// object; production never reassigns it. SERVER-ONLY.

import { sendTrialDeletedEmail, sendTrialWarningEmail } from "@/lib/email";
import { releaseAllTwilioNumbersFor } from "@/lib/release-user";

export const trialCleanupDeps = {
  sendWarning: sendTrialWarningEmail,
  /** The "Tamara is paused" e-mail (historical name: sendTrialDeletedEmail). */
  sendPaused: sendTrialDeletedEmail,
  releaseNumbers: releaseAllTwilioNumbersFor,
};
