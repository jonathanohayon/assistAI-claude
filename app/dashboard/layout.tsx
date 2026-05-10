import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { Logo } from "@/components/ui/Logo";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

import { DashboardTabs } from "./_nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [me] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  // Trial countdown — shown as a banner above the tabs.
  const trialDaysLeft = (() => {
    if (!me?.trialEndsAt) return null;
    if (me.subscriptionStatus !== "trialing") return null;
    const ms = new Date(me.trialEndsAt).getTime() - Date.now();
    if (ms <= 0) return 0;
    return Math.ceil(ms / (24 * 60 * 60 * 1000));
  })();

  const googleConnected = Boolean(me?.googleRefreshToken);

  async function handleLogout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-[var(--color-border)]/60 bg-white/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Logo />
            </Link>
            <span className="hidden h-4 w-px bg-[var(--color-border)] sm:block" />
            <p className="hidden text-sm text-[var(--color-muted-foreground)] sm:block">
              Dashboard
            </p>
          </div>
          <div className="flex items-center gap-3">
            {me?.role === "admin" && (
              <Link
                href="/admin"
                className="hidden rounded-full bg-[var(--color-primary)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20 sm:inline-flex"
              >
                Admin
              </Link>
            )}
            <span className="hidden text-xs text-[var(--color-muted-foreground)] sm:inline">
              {session.user.email}
            </span>
            <form action={handleLogout}>
              <button className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] shadow-xs transition-colors hover:bg-[var(--color-muted)]">
                Déconnexion
              </button>
            </form>
          </div>
        </div>
      </header>

      {!googleConnected && (
        <div className="mx-auto w-full max-w-5xl px-6 pt-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 sm:text-sm">
            <span>
              Google Calendar non connecté. Sans ça, votre agent ne peut pas
              prendre de rendez-vous dans VOTRE calendrier.
            </span>
            <a
              href="/api/onboarding/google/start"
              className="whitespace-nowrap rounded-full bg-[var(--color-foreground)] px-3 py-1 text-[11px] font-medium text-white"
            >
              Connecter
            </a>
          </div>
        </div>
      )}

      {trialDaysLeft != null && (
        <div
          className={`mx-auto w-full max-w-5xl px-6 pt-4 ${
            trialDaysLeft <= 0
              ? "text-red-700"
              : trialDaysLeft <= 2
              ? "text-amber-700"
              : "text-[var(--color-muted-foreground)]"
          }`}
        >
          <div
            className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2 text-xs sm:text-sm ${
              trialDaysLeft <= 0
                ? "border-red-200 bg-red-50"
                : trialDaysLeft <= 2
                ? "border-amber-200 bg-amber-50"
                : "border-[var(--color-border)] bg-white"
            }`}
          >
            <span>
              {trialDaysLeft <= 0 ? (
                <>Votre essai est terminé. Activez un plan pour continuer.</>
              ) : (
                <>
                  Essai gratuit · <strong>{trialDaysLeft} jour{trialDaysLeft > 1 ? "s" : ""} restant{trialDaysLeft > 1 ? "s" : ""}</strong>
                </>
              )}
            </span>
            <button
              disabled
              className="rounded-full bg-[var(--color-foreground)] px-3 py-1 text-[11px] font-medium text-white opacity-60"
              title="Bientôt disponible"
            >
              Souscrire
            </button>
          </div>
        </div>
      )}

      <DashboardTabs />

      {children}
    </div>
  );
}
