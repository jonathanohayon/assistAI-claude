// Production wiring of the recap email code handlers (the two route.ts).
// Tests reuse it and replace only the session and the sender, or build it
// with other limits (makeRecapEmailCodeDeps).
import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { generateCode, generateSalt } from "@/lib/contact-code";
import { confirmContactCode, dropContactCode, issueContactCode, loadContactForCode } from "@/lib/contact-code-store";
import { sendContactCodeEmail } from "@/lib/email";
import { emailSenderConfigured } from "@/lib/email-sender";
import { emailSenderSecrets } from "@/lib/email-test/secrets";
import { logEvent } from "@/lib/logger";
import type { CodeClaim, RecapEmailCodeDeps } from "@/lib/recap-email-code/handler";
import {
  DAY_MS,
  HOUR_MS,
  RECAP_EMAIL_CODE_ACCOUNT_BUCKET,
  RECAP_EMAIL_CODE_LIMITS,
  RECAP_EMAIL_CODE_VALUE_BUCKET,
  type RecapEmailCodeLimits,
} from "@/lib/recap-email-code/policy";
import { consumeRateLimit } from "@/lib/rate-limit-db";

/**
 * The account (+ the global hourly ceiling) first, then the address. Each
 * accepted step is recorded at once (lib/rate-limit-db.ts), so parallel
 * requests cannot slip under a limit.
 */
export function claimRecapEmailCode(limits: RecapEmailCodeLimits = RECAP_EMAIL_CODE_LIMITS) {
  return async (userId: string, valueKey: string): Promise<CodeClaim> => {
    const account = await consumeRateLimit({
      bucket: RECAP_EMAIL_CODE_ACCOUNT_BUCKET,
      accountId: userId,
      windowMs: HOUR_MS,
      perAccount: limits.perAccountHourly,
      global: limits.globalHourly,
    });
    if (!account.ok) return account;
    const value = await consumeRateLimit({
      bucket: RECAP_EMAIL_CODE_VALUE_BUCKET,
      accountId: valueKey,
      windowMs: DAY_MS,
      perAccount: limits.perValueDaily,
      global: limits.valueLedgerDaily,
    });
    if (!value.ok) return { ok: false, scope: value.scope === "account" ? "value" : "global", retryAfterSec: value.retryAfterSec };
    return { ok: true };
  };
}

export function makeRecapEmailCodeDeps(limits: RecapEmailCodeLimits = RECAP_EMAIL_CODE_LIMITS): RecapEmailCodeDeps {
  return {
    resolveTarget: resolveTargetUserId,
    senderConfigured: () => emailSenderConfigured(),
    // userId = the scoped account (the ?asUserId tenant for admins): the
    // address and the locale are the TENANT's.
    loadContact: loadContactForCode,
    claim: claimRecapEmailCode(limits),
    generateCode,
    generateSalt,
    issue: issueContactCode,
    drop: dropContactCode,
    send: sendContactCodeEmail,
    confirm: (userId, kind, code) => confirmContactCode(userId, kind, code),
    log: logEvent,
    secrets: emailSenderSecrets,
  };
}

export const recapEmailCodeDeps: RecapEmailCodeDeps = makeRecapEmailCodeDeps();
