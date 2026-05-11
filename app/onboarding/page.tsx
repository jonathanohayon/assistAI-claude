import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { Logo } from "@/components/ui/Logo";
import { db } from "@/lib/db";
import { phoneNumbers, users } from "@/lib/db/schema";
import { planByKey } from "@/lib/plans";

import { OnboardingWizard } from "./wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Email verification gate : bouncer si pas encore verify.
  const [meCheck] = await db
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (meCheck && !meCheck.emailVerified) {
    redirect(`/verify-email?email=${encodeURIComponent(meCheck.email)}`);
  }

  // Already provisioned? Skip onboarding.
  const [existing] = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, session.user.id))
    .limit(1);

  if (existing) {
    redirect("/dashboard");
  }

  // Has the user already connected Google in a prior session?
  const [me] = await db
    .select({
      googleRefreshToken: users.googleRefreshToken,
      subscriptionPlan: users.subscriptionPlan,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  const googleConnected = Boolean(me?.googleRefreshToken);
  const plan = planByKey(me?.subscriptionPlan);

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 gradient-mesh"
      />

      <div className="w-full max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <Link href="/">
            <Logo />
          </Link>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {session.user.email} · 7 jours d&apos;essai gratuits
          </p>
        </div>

        {/* Plan recap — locks in what the user just chose on /pricing and
            tees up plan-specific notes shown inside the wizard. */}
        <div
          className={`mb-6 flex items-center justify-between gap-4 rounded-2xl border p-4 sm:p-5 ${
            plan.popular
              ? "border-transparent bg-gradient-to-br from-[#fff7ec] via-white to-[#fdf2f8] shadow-[0_12px_32px_-12px_rgba(212,165,116,0.4)] ring-1 ring-[#e5c08a]/60"
              : "border-[var(--color-border)] bg-white/85 shadow-sm"
          }`}
        >
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-primary)]">
              Formule active
            </p>
            <p className="mt-0.5 font-display text-lg text-[var(--color-foreground)]">
              {plan.name}
              {plan.popular && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-gradient-to-br from-[#d4a574] to-[#b8864e] px-2 py-0.5 align-middle text-[10px] font-semibold tracking-wide text-white">
                  ★ Populaire
                </span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
              {plan.monthly} € HT / mois · {plan.tagline}
            </p>
          </div>
          <Link
            href="/dashboard/billing"
            className="whitespace-nowrap rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-muted)]"
          >
            Changer
          </Link>
        </div>

        <div className="rounded-3xl border border-[var(--color-border)] bg-white/85 p-7 shadow-lg backdrop-blur sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
            Onboarding
          </p>
          <h1 className="mt-3 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
            Quelques minutes pour activer votre secrétaire.
          </h1>
          <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">
            Connectez votre Google Calendar (optionnel), puis on vous
            attribue un numéro Twilio dédié — tout compris dans l&apos;essai
            gratuit.
          </p>

          {/* Plan-specific guidance pulled from lib/plans.ts.
              Keeps the recap honest: each plan has unique onboarding hooks
              (e.g. WhatsApp setup for #2, multi-centre for #3, concierge
              for #4) instead of a one-size-fits-all flow. */}
          {plan.onboardingNotes.length > 0 && (
            <ul className="mt-6 space-y-2.5 rounded-2xl bg-[var(--color-muted)]/60 p-4 text-sm text-[var(--color-foreground)]">
              {plan.onboardingNotes.map((note) => (
                <li key={note} className="flex items-start gap-2.5">
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]"
                  >
                    <circle
                      cx="10"
                      cy="10"
                      r="9"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M10 6v4l2.5 2"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-8">
            <OnboardingWizard googleConnected={googleConnected} />
          </div>
        </div>
      </div>
    </main>
  );
}
