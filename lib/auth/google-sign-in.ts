// The Google branch of auth.ts → callbacks.signIn: find-or-create the tenant.
// JWT strategy without a DB adapter, so creation/linking happens here. Linking
// is by VERIFIED email (Google's email_verified). The cookie store is injected
// so the DB suite drives it without a request scope (Google is never called).

import { eq } from "drizzle-orm";

import { provisionTenant } from "@/lib/auth/provision-tenant";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { parseDoor } from "@/lib/door";
import { logEvent } from "@/lib/logger";
import { DEFAULT_PLAN_KEY, isValidPlanKey } from "@/lib/plans";

const SUPPORTED_LOCALES = ["fr", "he", "en"];

/** The short sign-up cookies set by startGoogleSignup (app/[locale]/signup/page.tsx). */
export const SIGNUP_COOKIES = ["signup_plan", "signup_locale", "signup_door"] as const;

export interface SignupCookieStore {
  get(name: string): { value: string } | undefined;
  delete(name: string): unknown;
}

export async function googleSignIn(
  { account, profile }: { account?: { provider?: string } | null; profile?: { email?: string | null; name?: string | null } | null },
  cookieStore: SignupCookieStore,
): Promise<boolean | string> {
  if (account?.provider !== "google") return true;

  const email = String(profile?.email ?? "")
    .trim()
    .toLowerCase();
  if (!email) return false;
  // Refuse an unverified Google email (rare, but no pre-verified account is
  // created on a doubtful email).
  if ((profile as { email_verified?: boolean })?.email_verified === false) {
    return false;
  }

  // Cookies set by the sign-up page's "Continue with Google" button (absent
  // from the login page). Consumed one-shot: signup_plan's presence alone
  // marks a SIGN-UP INTENT, which tells a sign-up-on-an-existing-account
  // (→ popup) from a plain login. signup_door is applied to a NEW account
  // only; a login never changes the door.
  const planCookie = cookieStore.get("signup_plan")?.value;
  const localeCookie = cookieStore.get("signup_locale")?.value;
  const doorCookie = cookieStore.get("signup_door")?.value;
  const isSignupIntent = planCookie !== undefined;
  const locale =
    localeCookie && SUPPORTED_LOCALES.includes(localeCookie)
      ? localeCookie
      : "fr";
  for (const name of SIGNUP_COOKIES) cookieStore.delete(name);

  const [existing] = await db
    .select({ id: users.id, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    if (isSignupIntent) {
      // "Sign up with Google" on an existing account → NOT signed in, sent to
      // /login with an "already registered" popup. Returning a string =
      // redirect without a session (cf. @auth/core handleAuthorized).
      await logEvent({
        source: "auth",
        event: "signup_google_exists",
        message: "Signup Google refusé — compte déjà existant",
        userId: existing.id,
      });
      return `/${locale}/login?notice=exists`;
    }
    // Login intent → link by verified email and sign in.
    if (!existing.emailVerified) {
      await db
        .update(users)
        .set({ emailVerified: true })
        .where(eq(users.id, existing.id));
    }
    await logEvent({
      source: "auth",
      event: "login_success",
      message: "Login Google",
      userId: existing.id,
    });
    return true;
  }

  // New tenant. Email already verified → no /verify-email gate; it is routed
  // to /onboarding (redirectTo) to pick its number.
  const plan = isValidPlanKey(planCookie) ? planCookie : DEFAULT_PLAN_KEY;
  const created = await provisionTenant({
    email,
    displayName: String(profile?.name ?? "").trim(),
    plan,
    locale,
    emailVerified: true,
    door: parseDoor(doorCookie),
  });
  await logEvent({
    source: "auth",
    event: "signup_google",
    message: `Signup Google (plan ${plan})`,
    userId: created.id,
  });
  return true;
}
