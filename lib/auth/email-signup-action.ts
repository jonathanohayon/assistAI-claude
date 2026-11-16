// The email/password sign-up server action (app/[locale]/signup/page.tsx),
// with its I/O injected so every redirect it can take is unit-tested.
// The door (lib/door.ts) comes from the form's hidden "door" field, is parsed
// server-side, stored at account creation, and kept on every bounce back to
// the sign-up page so a retry still signs up through the same door.

import { parseDoor, withDoor } from "@/lib/door";
import type { Door } from "@/lib/door-values";
import type { SignupError, SignupOutcome } from "@/lib/verification-limits/signup";

/** /<locale>/signup?error=<code>, plus &door=<door> unless it is "reception". */
export function signupErrorPath(locale: string, error: SignupError, door: Door): string {
  return withDoor(`/${locale}/signup?error=${error}`, door);
}

export interface EmailSignupActionDeps {
  signup(input: { email: unknown; password: unknown; locale: string; ip: string; door: Door }): Promise<SignupOutcome>;
  /** Credentials sign-in; throws (Next's redirect, or an auth error). */
  signIn(email: string, password: string): Promise<unknown>;
  /** The auth error's type when `e` is one, else null (rethrown as is). */
  authErrorType(e: unknown): string | null;
  redirect(url: string): never;
}

export async function emailSignupAction(
  formData: FormData,
  ctx: { locale: string; ip: string },
  deps: EmailSignupActionDeps,
): Promise<void> {
  const door = parseDoor(formData.get("door"));
  const outcome = await deps.signup({
    email: formData.get("email"),
    password: formData.get("password"),
    locale: ctx.locale,
    ip: ctx.ip,
    door,
  });
  if (!outcome.ok) return deps.redirect(signupErrorPath(ctx.locale, outcome.error, door));
  const { email } = outcome;
  const password = String(formData.get("password") ?? "");

  try {
    await deps.signIn(email, password);
  } catch (e) {
    // The account now exists: a sign-in failure goes to the login page
    // (which has no door; the door is already stored on the account).
    const type = deps.authErrorType(e);
    if (type !== null) return deps.redirect(`/login?error=${type}`);
    throw e;
  }
}
