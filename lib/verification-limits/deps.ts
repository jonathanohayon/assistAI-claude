// Production wiring of the resend-verification handler and the signup action.
// Tests reuse it and replace only the sender (and the logger).
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { provisionTenant } from "@/lib/auth/provision-tenant";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { sendVerificationEmail } from "@/lib/email";
import { logEvent } from "@/lib/logger";
import { TRIAL_PLAN_KEY } from "@/lib/plans";
import { consumeRateLimit } from "@/lib/rate-limit-db";
import type { ResendDeps } from "@/lib/verification-limits/resend";
import type { SignupDeps } from "@/lib/verification-limits/signup";
import { createEmailVerification } from "@/lib/verify-code";

export const resendDeps: ResendDeps = {
  consume: consumeRateLimit,
  findUser: async (email) => {
    const [u] = await db
      .select({ id: users.id, emailVerified: users.emailVerified, locale: users.locale })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return u ?? null;
  },
  createCode: (userId) => createEmailVerification(userId),
  send: sendVerificationEmail,
  log: logEvent,
};

export const signupDeps: SignupDeps = {
  consume: consumeRateLimit,
  findUser: async (email) => {
    const [u] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return u ?? null;
  },
  hashPassword: (password) => bcrypt.hash(password, 12),
  // emailVerified=false → the /verify-email gate. The trial gets every feature
  // (TRIAL_PLAN_KEY); the display name is collected at onboarding.
  provision: ({ email, locale, passwordHash }) =>
    provisionTenant({ email, displayName: "", plan: TRIAL_PLAN_KEY, locale, emailVerified: false, passwordHash }),
  createCode: (userId) => createEmailVerification(userId, { skipCooldown: true }),
  send: sendVerificationEmail,
  log: logEvent,
};
