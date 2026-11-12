// Email/password signup (the server action in app/[locale]/signup/page.tsx),
// with every I/O injected so tests can run it against a throwaway database
// and a fake sender. Each accepted signup creates a trial tenant and sends one
// verification email, so it is capped per client IP and route-wide BEFORE the
// account lookup: over the cap, no account is created and no email is sent.
// The page signs the new user in on { ok: true } and redirects with
// ?error=<code> otherwise.

import type { LogEvent } from "@/lib/logger";
import type { RateLimitResult } from "@/lib/rate-limit-db-core";
import {
  HOUR_MS,
  limiterKey,
  normaliseEmail,
  SIGNUP_BUCKET,
  SIGNUP_GLOBAL_PER_HOUR,
  SIGNUP_PER_IP_PER_HOUR,
} from "@/lib/verification-limits/policy";
import type { VerificationSendResult } from "@/lib/verification-limits/resend";

export type SignupError = "invalid" | "exists" | "exists_google" | "rate_limited";
export type SignupOutcome = { ok: true; email: string; userId: string } | { ok: false; error: SignupError };

export interface SignupDeps {
  consume(opts: { bucket: string; accountId: string; windowMs: number; perAccount: number; global: number }): Promise<RateLimitResult>;
  findUser(email: string): Promise<{ passwordHash: string } | null>;
  hashPassword(password: string): Promise<string>;
  provision(input: { email: string; locale: string; passwordHash: string }): Promise<{ id: string }>;
  createCode(userId: string): Promise<{ ok: boolean; code?: string; reason?: string }>;
  send(to: string, code: string, locale: string): Promise<VerificationSendResult>;
  log(ev: LogEvent): Promise<void>;
}

export async function signupWithEmail(
  input: { email: unknown; password: unknown; locale: string; ip: string },
  deps: SignupDeps,
): Promise<SignupOutcome> {
  const email = normaliseEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";
  if (!email.includes("@") || password.length < 8) return { ok: false, error: "invalid" };

  // Counted before anything else (also caps "exists" probing from one IP).
  let verdict: RateLimitResult;
  try {
    verdict = await deps.consume({
      bucket: SIGNUP_BUCKET,
      accountId: limiterKey(input.ip),
      windowMs: HOUR_MS,
      perAccount: SIGNUP_PER_IP_PER_HOUR,
      global: SIGNUP_GLOBAL_PER_HOUR,
    });
  } catch {
    await deps.log({
      source: "auth",
      level: "error",
      event: "signup_limiter_failed",
      message: "Signup: rate limiter unavailable",
    });
    return { ok: false, error: "rate_limited" };
  }
  if (!verdict.ok) {
    await deps.log({
      source: "auth",
      level: "warn",
      event: "signup_rate_limited",
      message: `Signup refused: ${verdict.scope} limit`,
      metadata: { scope: verdict.scope },
    });
    return { ok: false, error: "rate_limited" };
  }

  const existing = await deps.findUser(email);
  if (existing) {
    // Google account (sentinel passwordHash "") → point the user to Google sign-in.
    return { ok: false, error: existing.passwordHash === "" ? "exists_google" : "exists" };
  }

  const passwordHash = await deps.hashPassword(password);
  const created = await deps.provision({ email, locale: input.locale, passwordHash });

  // Verification gate: a 4-digit code by email. The page signs the user in
  // right after; the layouts send emailVerified=false users to /verify-email.
  const verif = await deps.createCode(created.id);
  if (verif.ok && verif.code) {
    let sent: VerificationSendResult;
    try {
      sent = await deps.send(email, verif.code, input.locale);
    } catch {
      sent = { ok: false, error: "exception" };
    }
    // Dev escape hatch: with no email sender configured the code is logged in
    // clear (visible in /dashboard/logs, Auth filter). In production
    // sent.fallback is undefined, so the code is never logged.
    const isDevFallback = sent.fallback === "console_log";
    await deps.log({
      source: "auth",
      event: sent.ok ? "verification_email_sent" : "verification_email_failed",
      message: sent.ok
        ? isDevFallback
          ? `[DEV] Code envoyé à ${email} : ${verif.code} (no email sender configured, no real email sent)`
          : `Code envoyé à ${email}`
        : `Envoi du code à ${email} échoué`,
      level: sent.ok ? (isDevFallback ? "warn" : "info") : "error",
      userId: created.id,
      metadata: {
        fallback: sent.fallback,
        error: sent.error,
        devCode: isDevFallback ? verif.code : undefined,
      },
    });
  } else {
    await deps.log({
      source: "auth",
      event: "verification_email_skipped",
      message: `Création de code échouée pour ${email} : ${verif.reason}`,
      level: "warn",
      userId: created.id,
    });
  }
  return { ok: true, email, userId: created.id };
}
