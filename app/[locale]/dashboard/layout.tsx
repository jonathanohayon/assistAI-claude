import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import NextLink from "next/link";

import { auth, signOut } from "@/auth";
import { AuroraBackground } from "@/components/AuroraBackground";
import { IdleWatcher } from "@/components/IdleWatcher";
import { LocaleSwitcher } from "@/components/marketing/LocaleSwitcher";
import { Logo } from "@/components/ui/Logo";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { featuresForPlan } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import { getPlanPricingMap } from "@/lib/plan-pricing-storage";
import { PLANS } from "@/lib/plans";
import { currentPeriodWindow } from "@/lib/subscription";

import { DashboardTabs } from "./_nav";
import { UserMenu } from "./user-menu";
import { TrialExpiredGate } from "./billing/trial-expired-gate";

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
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);

  const [me] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (me && !me.emailVerified) {
    redirect(`/${locale}/verify-email?email=${encodeURIComponent(me.email)}`);
  }

  // Trial countdown — shown as a banner above the tabs.
  const trial = (() => {
    if (!me?.trialEndsAt) return null;
    if (me.subscriptionStatus !== "trialing") return null;
    const ms = new Date(me.trialEndsAt).getTime() - Date.now();
    if (ms <= 0) return { label: "expired" as const, urgency: "critical" as const };
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const label = hours > 0 ? `${hours}h${minutes > 0 ? ` ${minutes}min` : ""}` : `${minutes} min`;
    const urgency =
      ms <= 2 * 60 * 60 * 1000 ? ("critical" as const) : ("normal" as const);
    return { label, urgency };
  })();

  // Essai terminé et compte non payé → gate bloquant (choix formule + CB).
  // Les admins n'y sont jamais soumis. Réutilise currentPeriodWindow.
  const trialOver =
    !!me &&
    me.role !== "admin" &&
    currentPeriodWindow(
      {
        subscriptionStatus: me.subscriptionStatus,
        subscriptionPlan: me.subscriptionPlan,
        subscriptionPeriod: me.subscriptionPeriod as "monthly" | "annual" | null,
        trialEndsAt: me.trialEndsAt,
        paidUntil: me.paidUntil,
      },
      new Date(),
    ).kind === "expired";
  const gatePricing = trialOver ? await getPlanPricingMap() : null;

  const googleConnected = Boolean(me?.googleRefreshToken);
  const planMatrix = await getPlanFeatureMatrix();
  const features = featuresForPlan(planMatrix, me?.subscriptionPlan);

  const t = await getTranslations({ locale, namespace: "Dashboard" });

  async function handleLogout() {
    "use server";
    // signOut({ redirectTo }) est ignoré en server action (bug NextAuth v5
    // avec form action). On utilise redirect: false + redirect() Next pour
    // forcer la destination. Sortie = la home page localisée (et pas /login
    // qui forcerait le user à se reconnecter alors qu'il a explicitement
    // demandé à se déconnecter — il vient de cliquer "Se déconnecter").
    await signOut({ redirect: false });
    redirect(`/${locale}`);
  }

  return (
    <div className="relative min-h-screen">
      <AuroraBackground />
      <IdleWatcher />
      {trialOver && gatePricing && (
        <TrialExpiredGate
          plans={[...PLANS]}
          pricing={gatePricing}
          logoutAction={handleLogout}
        />
      )}
      <header className="sticky top-0 z-40 border-b border-[var(--color-border)]/60 bg-white/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Logo />
            </Link>
            <span className="hidden h-4 w-px bg-[var(--color-border)] sm:block" />
            <p className="hidden text-sm text-[var(--color-muted-foreground)] sm:block">
              {t("header")}
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <LocaleSwitcher />
            {me?.role === "admin" && (
              // NextLink raw (pas locale-aware) — /admin n'a pas de version
              // sous [locale] (interface admin volontairement non-i18n).
              // Le Link de @/i18n/navigation préfixerait → /en/admin → 404.
              <NextLink
                href="/admin"
                className="inline-flex items-center rounded-full bg-[var(--color-primary)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20"
              >
                {t("admin")}
              </NextLink>
            )}
            <UserMenu
              email={session.user.email ?? ""}
              initials={getInitials(me?.displayName, session.user.email)}
              logoutAction={handleLogout}
            />
          </div>
        </div>
      </header>

      {!googleConnected && me?.subscriptionPlan !== "whatsapp" && (
        <div className="relative z-10 mx-auto w-full max-w-5xl px-6 pt-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 sm:text-sm">
            <span>{t("googleNotConnected")}</span>
            <a
              href="/api/onboarding/google/start"
              className="whitespace-nowrap rounded-full bg-[var(--color-foreground)] px-3 py-1 text-[11px] font-medium text-white"
            >
              {t("connectButton")}
            </a>
          </div>
        </div>
      )}

      {me?.subscriptionPlan === "whatsapp" && (
        <div className="relative z-10 mx-auto w-full max-w-5xl px-6 pt-4">
          <div className="flex flex-col items-start gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/50 px-4 py-2.5 text-xs text-[var(--color-muted-foreground)] sm:flex-row sm:items-center sm:justify-between sm:text-sm">
            <span>
              <strong className="text-[var(--color-foreground)]">
                {t("whatsappPlanLabel")}
              </strong>{" "}
              {t("whatsappPlanDesc")}
            </span>
            <Link
              href="/dashboard/billing"
              className="whitespace-nowrap rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-3 py-1 text-[11px] font-medium text-white"
            >
              {t("upgradeLink")}
            </Link>
          </div>
        </div>
      )}

      {trial != null && (
        <div
          className={`relative z-10 mx-auto w-full max-w-5xl px-6 pt-4 ${
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
                t("trialExpired")
              ) : (
                <>
                  {t("trialRemainingMessage", { label: trial.label })}
                  {trial.urgency === "critical" && (
                    <> · {t("trialAccountDeletion")}</>
                  )}
                </>
              )}
            </span>
            <Link
              href="/dashboard/billing"
              className="rounded-full bg-[var(--color-foreground)] px-3 py-1 text-[11px] font-medium text-white hover:bg-[var(--color-primary)]"
            >
              {t("trialSubscribeButton")}
            </Link>
          </div>
        </div>
      )}

      <DashboardTabs features={features} isAdmin={me?.role === "admin"} />

      {/* Wrapper relative z-10 → le contenu passe au-dessus du mesh aurora
       *  (qui est en `fixed z-0`). Sans ça, le content static serait derrière. */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
