// Is an email sender configured for tenant-triggered emails? (server-only)
//
// The supplier's sandbox sender (lib/email.ts FROM_DEFAULT) must never send an
// email a TENANT triggered: the owner recap and the dashboard test email
// refuse instead when no sender is set. This is the ONE check they use.
// It returns a boolean only: never the value, never the variable's name, to a
// caller that might put it in a response.

type Env = Record<string, string | undefined>;

/** The configured sender, or null when it is unset or blank. Server-side use only. */
export function configuredEmailSender(env: Env = process.env): string | null {
  const v = env.EMAIL_FROM;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** true when a sender is configured (unset or blank → false). */
export function emailSenderConfigured(env: Env = process.env): boolean {
  return configuredEmailSender(env) !== null;
}
