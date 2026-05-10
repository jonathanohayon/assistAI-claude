import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { Logo } from "@/components/ui/Logo";
import { db } from "@/lib/db";
import { phoneNumbers } from "@/lib/db/schema";

import { OnboardingWizard } from "./wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Already provisioned? Skip onboarding.
  const [existing] = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, session.user.id))
    .limit(1);

  if (existing) {
    redirect("/dashboard");
  }

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

        <div className="rounded-3xl border border-[var(--color-border)] bg-white/85 p-7 shadow-lg backdrop-blur sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
            Étape 1/1
          </p>
          <h1 className="mt-3 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
            Choisissez votre numéro.
          </h1>
          <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">
            Votre secrétaire vocale aura besoin d&apos;une ligne dédiée. On en
            achète une chez Twilio et on la branche automatiquement à
            l&apos;agent — c&apos;est compris dans l&apos;essai gratuit.
          </p>

          <div className="mt-8">
            <OnboardingWizard />
          </div>
        </div>
      </div>
    </main>
  );
}
