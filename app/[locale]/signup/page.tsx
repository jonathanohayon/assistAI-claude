import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { AuthError } from "next-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { provisionTenant } from "@/lib/auth/provision-tenant";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { sendVerificationEmail } from "@/lib/email";
import { logEvent } from "@/lib/logger";
import { DEFAULT_PLAN_KEY, isValidPlanKey } from "@/lib/plans";
import { createEmailVerification } from "@/lib/verify-code";

import { SignupContent } from "./signup-content";

// Page localisée /<fr|he|en>/signup — la version racine /signup à été
// déplacée ici pour bénéficier du NextIntlClientProvider de [locale]/layout.
// Une page de compatibilité reste à /signup pour rediriger les anciens
// liens (bookmarks, emails) vers la version localisée.
export default async function SignupPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; plan?: string; billing?: string }>;
}) {
  const { locale } = await props.params;
  const { error, plan: planParam, billing } = await props.searchParams;

  const session = await auth();
  if (session?.user) {
    // Logged-in users hitting signup with ?plan are forwarded to the upgrade
    // page so they can change subscription instead of creating a duplicate.
    if (planParam) {
      redirect(`/dashboard/billing?plan=${planParam}&billing=${billing ?? ""}`);
    }
    redirect("/dashboard");
  }

  const selectedPlanKey = isValidPlanKey(planParam)
    ? planParam
    : DEFAULT_PLAN_KEY;
  const billingMode = billing === "annual" ? "annual" : "monthly";

  async function handleSignup(formData: FormData) {
    "use server";

    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const displayName = String(formData.get("displayName") ?? "").trim();
    const planRaw = String(formData.get("plan") ?? "");
    const subscriptionPlan = isValidPlanKey(planRaw)
      ? planRaw
      : DEFAULT_PLAN_KEY;

    if (!email.includes("@") || password.length < 8) {
      redirect(`/${locale}/signup?error=invalid&plan=${subscriptionPlan}`);
    }

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing.length > 0) {
      redirect(`/${locale}/signup?error=exists&plan=${subscriptionPlan}`);
    }

    const hash = await bcrypt.hash(password, 12);
    // Crée le tenant (users + agent_config). emailVerified=false → gate
    // /verify-email actif pour le signup email/mdp (cf. logique ci-dessous).
    const created = await provisionTenant({
      email,
      displayName,
      plan: subscriptionPlan,
      locale,
      emailVerified: false,
      passwordHash: hash,
    });

    // Email verification gate : crée un code 4 chiffres, l'envoie par mail.
    // On signIn IMMÉDIATEMENT après création pour que le user reste loggué,
    // mais les layouts /dashboard /admin /onboarding détectent
    // emailVerified=false et redirigent vers /verify-email tant que pas
    // validé. Évite au user d'avoir à retaper son mdp après verify.
    const verif = await createEmailVerification(created.id, {
      skipCooldown: true,
    });
    if (verif.ok && verif.code) {
      const sent = await sendVerificationEmail(email, verif.code, locale);
      // Dev escape-hatch : si RESEND_API_KEY n'est pas configuré, on log
      // le code en CLAIR dans le message pour le retrouver depuis
      // /dashboard/logs (filtre Auth). EN PROD avec RESEND_API_KEY set,
      // sent.fallback est undefined → code jamais loggué en clair.
      const isDevFallback = sent.fallback === "console_log";
      await logEvent({
        source: "auth",
        event: sent.ok ? "verification_email_sent" : "verification_email_failed",
        message: sent.ok
          ? isDevFallback
            ? `[DEV] Code envoyé à ${email} : ${verif.code} (RESEND_API_KEY absent, vrai email pas envoyé)`
            : `Code envoyé à ${email}`
          : `Envoi du code à ${email} échoué : ${sent.error}`,
        level: sent.ok ? (isDevFallback ? "warn" : "info") : "error",
        userId: created.id,
        metadata: {
          fallback: sent.fallback,
          error: sent.error,
          // Code en clair UNIQUEMENT en fallback dev — jamais en prod.
          devCode: isDevFallback ? verif.code : undefined,
        },
      });
    } else {
      await logEvent({
        source: "auth",
        event: "verification_email_skipped",
        message: `Création de code échouée pour ${email} : ${verif.reason}`,
        level: "warn",
        userId: created.id,
      });
    }

    try {
      await signIn("credentials", {
        email,
        password,
        redirectTo: "/verify-email",
      });
    } catch (e) {
      if (e instanceof AuthError) {
        redirect(`/login?error=${e.type}`);
      }
      throw e;
    }
  }

  async function startGoogleSignup(formData: FormData) {
    "use server";
    // Le plan coché et la locale sont transmis au callback signIn Google via
    // des cookies courts (httpOnly, 10 min). Voir auth.ts → callbacks.signIn.
    const planRaw = String(formData.get("plan") ?? "");
    const plan = isValidPlanKey(planRaw) ? planRaw : DEFAULT_PLAN_KEY;
    const cookieStore = await cookies();
    const opts = {
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
      maxAge: 600,
    };
    cookieStore.set("signup_plan", plan, opts);
    cookieStore.set("signup_locale", locale, opts);
    await signIn("google", { redirectTo: "/dashboard" });
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 gradient-mesh"
      />
      <SignupContent
        initialPlanKey={selectedPlanKey}
        billingMode={billingMode}
        error={error}
        handleSignup={handleSignup}
        startGoogleSignup={startGoogleSignup}
      />
    </main>
  );
}
