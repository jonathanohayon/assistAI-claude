import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { AuthError } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Logo } from "@/components/ui/Logo";
import { auth, signIn } from "@/auth";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { sendVerificationEmail } from "@/lib/email";
import {
  INITIAL_GREETING_INSTRUCTIONS,
  INITIAL_INSTRUCTIONS,
} from "@/lib/initial-config";
import { logEvent } from "@/lib/logger";
import {
  DEFAULT_PLAN_KEY,
  PLANS,
  isValidPlanKey,
  planByKey,
} from "@/lib/plans";
import { getOnboardingTemplate } from "@/lib/settings";
import { createEmailVerification } from "@/lib/verify-code";

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
  const selectedPlan = planByKey(selectedPlanKey);
  const billingMode = billing === "annual" ? "annual" : "monthly";
  const monthlyPrice =
    billingMode === "annual"
      ? selectedPlan.annualMonthly
      : selectedPlan.monthly;

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
    // 7-day free trial starts at signup. Onboarding may bump trialEndsAt
    // again if the user takes a few days to provision their number.
    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

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

  const errorMsg: Record<string, string> = {
    invalid: "Email invalide ou mot de passe trop court (8 caractères min).",
    exists: "Un compte existe déjà avec cet email.",
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 gradient-mesh"
      />

      <div className="grid w-full max-w-4xl gap-6 lg:grid-cols-[1.1fr_1fr] lg:gap-8">
        {/* Plan recap (mobile shows it above the form) */}
        <aside className="order-2 lg:order-1">
          <div className="sticky top-8 rounded-3xl border border-[var(--color-border)] bg-white/90 p-6 shadow-md backdrop-blur sm:p-7">
            <Link href="/" className="inline-block">
              <Logo />
            </Link>

            <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
              Formule choisie
            </p>
            <h2 className="mt-2 font-display text-2xl tracking-tight text-[var(--color-foreground)]">
              {selectedPlan.name}
              {selectedPlan.popular && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-gradient-to-br from-[#d4a574] to-[#b8864e] px-2 py-0.5 align-middle text-[10px] font-semibold tracking-wide text-white">
                  ★ Populaire
                </span>
              )}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              {selectedPlan.tagline}
            </p>

            <div className="mt-5 flex items-baseline gap-1.5">
              <span className="font-display text-4xl tracking-tight text-[var(--color-foreground)]">
                {monthlyPrice} €
              </span>
              <span className="text-sm text-[var(--color-muted-foreground)]">
                HT / mois
              </span>
              {billingMode === "annual" && (
                <span className="ml-2 rounded-full bg-[#fef3c7] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[#b45309]">
                  −20% annuel
                </span>
              )}
            </div>

            <ul className="mt-6 space-y-2.5 border-t border-[var(--color-border)]/70 pt-5">
              {selectedPlan.features.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2.5 text-sm text-[var(--color-foreground)]"
                >
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]"
                  >
                    <circle
                      cx="10"
                      cy="10"
                      r="10"
                      fill="currentColor"
                      fillOpacity="0.12"
                    />
                    <path
                      d="m6 10.5 2.5 2.5L14 7.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <p className="mt-5 rounded-xl bg-[var(--color-muted)] px-3 py-2 text-[11px] text-[var(--color-muted-foreground)]">
              7 jours d&apos;essai gratuit. Sans engagement, changeable depuis
              le dashboard.{" "}
              <Link
                href="/#pricing"
                className="underline underline-offset-2 hover:text-[var(--color-foreground)]"
              >
                Comparer les formules
              </Link>
              .
            </p>
          </div>
        </aside>

        {/* Signup form */}
        <div className="order-1 lg:order-2">
          <form
            action={handleSignup}
            className="relative flex flex-col gap-4 rounded-3xl border border-[var(--color-border)] bg-white/85 p-7 shadow-lg backdrop-blur"
          >
            <div className="space-y-1">
              <h1 className="font-display text-2xl tracking-tight text-[var(--color-foreground)]">
                Créer un compte
              </h1>
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Donnez une voix à votre cabinet en 5 minutes.
              </p>
            </div>

            {error && errorMsg[error] && (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                {errorMsg[error]}
              </p>
            )}

            {/* Plan picker — defaults to whatever ?plan= came from Pricing,
                but the user can change their mind without leaving the page. */}
            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="font-medium text-[var(--color-foreground)]">
                Formule
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {PLANS.map((p) => {
                  const checked = p.key === selectedPlanKey;
                  // Style driven by :has(:checked) (Tailwind 4) → la card
                  // se met à jour visuellement quand le user clique une
                  // autre option, pas seulement au render initial.
                  return (
                    <label
                      key={p.key}
                      className="relative cursor-pointer rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 transition-all hover:border-[var(--color-primary)]/50 has-[:checked]:border-[var(--color-primary)] has-[:checked]:ring-2 has-[:checked]:ring-[var(--color-primary)]/20"
                    >
                      <input
                        type="radio"
                        name="plan"
                        value={p.key}
                        defaultChecked={checked}
                        className="peer sr-only"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-[var(--color-foreground)]">
                          {p.name}
                        </span>
                        {p.popular && (
                          <span className="rounded-full bg-gradient-to-br from-[#d4a574] to-[#b8864e] px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-white">
                            ★
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">
                        {p.monthly} € / mois
                      </div>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-[var(--color-foreground)]">
                Nom du salon / cabinet
              </span>
              <input
                name="displayName"
                type="text"
                required
                placeholder="Salon Prestige"
                className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-[var(--color-foreground)]">
                Email
              </span>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-[var(--color-foreground)]">
                Mot de passe
              </span>
              <input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
              />
              <span className="text-xs text-[var(--color-muted-foreground)]">
                8 caractères minimum.
              </span>
            </label>

            <button
              type="submit"
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white shadow-md transition-transform hover:scale-[1.01] active:scale-[0.99]"
            >
              Créer mon compte
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                <path
                  d="M5 12h14M13 5l7 7-7 7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            <p className="text-center text-xs text-[var(--color-muted-foreground)]">
              Déjà un compte ?{" "}
              <Link
                href="/login"
                className="text-[var(--color-primary)] hover:underline"
              >
                Connexion
              </Link>
            </p>
          </form>

          <p className="mt-6 text-center text-xs text-[var(--color-muted-foreground)]">
            <Link href="/" className="hover:text-[var(--color-foreground)]">
              ← Retour
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
