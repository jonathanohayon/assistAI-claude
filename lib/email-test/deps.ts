// Production wiring of the email-test handler (route.ts). Tests reuse it and
// replace only the session and the sender.
import { eq } from "drizzle-orm";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { sendNotificationTestEmail } from "@/lib/email";
import type { EmailTestDeps } from "@/lib/email-test/handler";
import {
  EMAIL_TEST_BUCKET,
  EMAIL_TEST_GLOBAL_LIMIT,
  EMAIL_TEST_PER_ACCOUNT_LIMIT,
  EMAIL_TEST_WINDOW_MS,
} from "@/lib/email-test/policy";
import { emailSenderSecrets } from "@/lib/email-test/secrets";
import { logEvent } from "@/lib/logger";
import { consumeRateLimit } from "@/lib/rate-limit-db";

export const emailTestDeps: EmailTestDeps = {
  resolveTarget: resolveTargetUserId,
  // userId = the scoped account (the ?asUserId tenant for admins), so both
  // addresses are the TENANT's. The recap switch is not read: a saved address
  // may be tested before it is switched on.
  loadAccount: async (userId) => {
    const [u] = await db
      .select({ email: users.email, displayName: users.displayName, ownerRecapEmail: agentConfigs.ownerRecapEmail })
      .from(users)
      .leftJoin(agentConfigs, eq(agentConfigs.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    return u ? { loginEmail: u.email, ownerRecapEmail: u.ownerRecapEmail ?? "", displayName: u.displayName } : null;
  },
  // accountId = the scoped account (the ?asUserId tenant for admins).
  claim: (userId) =>
    consumeRateLimit({
      bucket: EMAIL_TEST_BUCKET,
      accountId: userId,
      windowMs: EMAIL_TEST_WINDOW_MS,
      perAccount: EMAIL_TEST_PER_ACCOUNT_LIMIT,
      global: EMAIL_TEST_GLOBAL_LIMIT,
    }),
  send: sendNotificationTestEmail,
  log: logEvent,
  secrets: emailSenderSecrets,
};
