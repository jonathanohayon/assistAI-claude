import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { AuthError } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Logo } from "@/components/ui/Logo";
import { auth, signIn } from "@/auth";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import {
  INITIAL_GREETING_INSTRUCTIONS,
  INITIAL_INSTRUCTIONS,
} from "@/lib/initial-config";
import { getOnboardingTemplate } from "@/lib/settings";

export default async function SignupPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const { error } = await props.searchParams;

  async function handleSignup(formData: FormData) {
    "use server";

    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const displayName = String(formData.get("displayName") ?? "").trim();

    if (!email.includes("@") || password.length < 8) {
      redirect("/signup?error=invalid");
    }

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing.length > 0) {
      redirect("/signup?error=exists");
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

    try {
      await signIn("credentials", {
        email,
        password,
        redirectTo: "/onboarding",
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

      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Link href="/">
            <Logo />
          </Link>
        </div>

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
            <span className="font-medium text-[var(--color-foreground)]">Email</span>
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
              <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <p className="text-center text-xs text-[var(--color-muted-foreground)]">
            Déjà un compte ?{" "}
            <Link href="/login" className="text-[var(--color-primary)] hover:underline">
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
    </main>
  );
}
