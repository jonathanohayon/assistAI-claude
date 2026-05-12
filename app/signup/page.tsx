import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { sendVerificationEmail } from "@/lib/email";
import {
  INITIAL_GREETING_INSTRUCTIONS,
  INITIAL_INSTRUCTIONS,
} from "@/lib/initial-config";
import { logEvent } from "@/lib/logger";
import { DEFAULT_PLAN_KEY, isValidPlanKey } from "@/lib/plans";
import { getOnboardingTemplate } from "@/lib/settings";
import { computeTrialEndsAt } from "@/lib/trial";
import { createEmailVerification } from "@/lib/verify-code";

import { SignupContent } from "./signup-content";

export default async function SignupPage(props: {
  searchParams: Promise<{ error?: string; plan?: string; billing?: string }>;
}) {
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
      redirect(`/signup?error=invalid&plan=${subscriptionPlan}`);
    }

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing.length > 0) {
      redirect(`/signup?error=exists&plan=${subscriptionPlan}`);
    }

    const hash = await bcrypt.hash(password, 12);
    // Free trial démarre au signup, durée définie dans lib/trial.ts.
    const trialEndsAt = computeTrialEndsAt();

    const [created] = await db
      .insert(users)
      .values({
        email,
        passwordHash: hash,
        displayName,
        role: "user",
        subscriptionStatus: "trialing",
        subscriptionPlan,
        trialEndsAt,
      })
      .returning();

    // Bootstrap an agent_config so the new tenant has something to edit
    // immediately. Use the admin-defined onboarding template if present,
    // otherwise fall back to the hard-coded canonical Johana persona.
    const adminTemplate = await getOnboardingTemplate();
    const seedInstructions = adminTemplate.trim()
      ? adminTemplate
      : INITIAL_INSTRUCTIONS;

    await db.insert(agentConfigs).values({
      userId: created.id,
      instructions: seedInstructions,
      greetingInstructions: INITIAL_GREETING_INSTRUCTIONS,
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
      const sent = await sendVerificationEmail(email, verif.code);
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
      />
    </main>
  );
}
