import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { IdleWatcher } from "@/components/IdleWatcher";
import { Logo } from "@/components/ui/Logo";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  featuresForPlan,
  getPlanFeatureMatrix,
} from "@/lib/plan-features";

import { DashboardTabs } from "./_nav";
import { UserMenu } from "./user-menu";

/**
 * "Sarah Cohen" → "SC" · "salon@prestige.com" → "S" · "" → "?"
 * Affiché dans l'avatar du UserMenu en lieu et place d'une vraie photo.
 */
function getInitials(displayName: string | null | undefined, email: string | null | undefined): string {
  const name = (displayName ?? "").trim();
  if (name) {
    const parts = name.split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0] ?? "").join("").toUpperCase() || "?";
  }
  const e = (email ?? "").trim();
  return (e[0] ?? "?").toUpperCase();
}

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

  // Email verification gate : un user inscrit mais qui n'a pas encore
  // validé son adresse est bouncé vers /verify-email. Empêche d'accéder
  // au dashboard tant que le code 4 chiffres reçu par mail n'est pas
  // entré. Le bypass admin (déjà migrés en backfill TRUE) est implicite.
  if (me && !me.emailVerified) {
    redirect(`/verify-email?email=${encodeURIComponent(me.email)}`);
  }

  // Trial countdown — shown as a banner above the tabs.
  // Trial dure 1 jour (cf. lib/trial.ts), donc on affiche heures+minutes
  // au lieu de "X jours". Retourne { label, urgency } pour piloter à la
  // fois le texte et la couleur du banner.
  const trial = (() => {
    if (!me?.trialEndsAt) return null;
    if (me.subscriptionStatus !== "trialing") return null;
    const ms = new Date(me.trialEndsAt).getTime() - Date.now();
    if (ms <= 0) return { label: "expired" as const, urgency: "critical" as const };
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const label = hours > 0 ? `${hours}h${minutes > 0 ? ` ${minutes}min` : ""}` : `${minutes} min`;
    // 2h restantes ou moins → critical (matche la fenêtre warning email)
    const urgency =
      ms <= 2 * 60 * 60 * 1000 ? ("critical" as const) : ("normal" as const);
    return { label, urgency };
  })();

  const googleConnected = Boolean(me?.googleRefreshToken);
  // Matrice plan × feature (éditable depuis /admin) → drive la visibilité
  // des onglets. Admin = toutes features (cf. bypass dans DashboardTabs).
  const planMatrix = await getPlanFeatureMatrix();
  const features = featuresForPlan(planMatrix, me?.subscriptionPlan);

  async function handleLogout() {
    "use server";
    // signOut({ redirectTo }) est ignoré en server action (bug NextAuth v5
    // avec form action). On utilise redirect: false + redirect() Next pour
    // forcer la destination /login au lieu de la home par défaut.
    await signOut({ redirect: false });
    redirect("/login");
  }

  return (
    <div className="min-h-screen">
      <IdleWatcher />
      <header className="sticky top-0 z-40 border-b border-[var(--color-border)]/60 bg-white/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Logo />
            </Link>
            <span className="hidden h-4 w-px bg-[var(--color-border)] sm:block" />
            <p className="hidden text-sm text-[var(--color-muted-foreground)] sm:block">
              Dashboard
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {me?.role === "admin" && (
              <Link
                href="/admin"
                className="inline-flex items-center rounded-full bg-[var(--color-primary)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20"
              >
                Admin
              </Link>
            )}
            <UserMenu
              email={session.user.email ?? ""}
              initials={getInitials(me?.displayName, session.user.email)}
              logoutAction={handleLogout}
            />
          </div>
        </div>
      </header>

      {/* Bannière "Google non connecté" uniquement pour les plans qui ont
          accès à cette feature (Globale + Premium). Sur WhatsApp, c'est
          intentionnel — afficher serait confus. */}
      {!googleConnected && me?.subscriptionPlan !== "whatsapp" && (
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

      {/* Bannière info pour les WhatsApp users : ils n'ont pas Google
          Calendar perso, mais peuvent upgrader à tout moment. */}
      {me?.subscriptionPlan === "whatsapp" && (
        <div className="mx-auto w-full max-w-5xl px-6 pt-4">
          <div className="flex flex-col items-start gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/50 px-4 py-2.5 text-xs text-[var(--color-muted-foreground)] sm:flex-row sm:items-center sm:justify-between sm:text-sm">
            <span>
              <strong className="text-[var(--color-foreground)]">
                Formule WhatsApp.
              </strong>{" "}
              Connexion à ton propre Google Calendar/Sheets verrouillée.
            </span>
            <Link
              href="/dashboard/billing"
              className="whitespace-nowrap rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-3 py-1 text-[11px] font-medium text-white"
            >
              Passer à Globale ou Premium →
            </Link>
          </div>
        </div>
      )}

      {trial != null && (
        <div
          className={`mx-auto w-full max-w-5xl px-6 pt-4 ${
            trial.urgency === "critical"
              ? trial.label === "expired"
                ? "text-red-700"
                : "text-amber-700"
              : "text-[var(--color-muted-foreground)]"
          }`}
        >
          <div
            className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2 text-xs sm:text-sm ${
              trial.urgency === "critical"
                ? trial.label === "expired"
                  ? "border-red-200 bg-red-50"
                  : "border-amber-200 bg-amber-50"
                : "border-[var(--color-border)] bg-white"
            }`}
          >
            <span>
              {trial.label === "expired" ? (
                <>Votre essai est terminé. Votre compte va être supprimé sous peu.</>
              ) : (
                <>
                  Essai gratuit · <strong>{trial.label} restant{trial.label.includes("h") ? "es" : ""}</strong>
                  {trial.urgency === "critical" && (
                    <> · compte supprimé à expiration</>
                  )}
                </>
              )}
            </span>
            <Link
              href="/dashboard/billing"
              className="rounded-full bg-[var(--color-foreground)] px-3 py-1 text-[11px] font-medium text-white hover:bg-[var(--color-primary)]"
            >
              Souscrire
            </Link>
          </div>
        </div>
      )}

      <DashboardTabs features={features} isAdmin={me?.role === "admin"} />

      {children}
    </div>
  );
}
