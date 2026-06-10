import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { Logo } from "@/components/ui/Logo";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { agentConfigs, phoneNumbers, users } from "@/lib/db/schema";

import { OnboardingWizard } from "./wizard";

export const dynamic = "force-dynamic";

type Language = "fr" | "he" | "en";

export default async function OnboardingPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);

  // Email verification gate : bouncer si pas encore verify.
  const [meCheck] = await db
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (meCheck && !meCheck.emailVerified) {
    redirect(`/${locale}/verify-email?email=${encodeURIComponent(meCheck.email)}`);
  }

  const [existing] = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, session.user.id))
    .limit(1);

  if (existing) {
    redirect("/dashboard");
  }

  // Préremplissage : nom affiché (entreprise) + langue principale de l'agent.
  const [me] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const [config] = await db
    .select({ primaryLanguage: agentConfigs.primaryLanguage })
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, session.user.id))
    .limit(1);

  // defaultCountry : hébreu → Israël, sinon France.
  const defaultCountry: "FR" | "IL" = locale === "he" ? "IL" : "FR";

  // initialLanguage : préférence agent si définie, sinon mappée sur la locale,
  // sinon fr.
  const isLang = (v: string | null | undefined): v is Language =>
    v === "fr" || v === "he" || v === "en";
  const initialLanguage: Language = isLang(config?.primaryLanguage)
    ? config!.primaryLanguage
    : isLang(locale)
      ? locale
      : "fr";

  const initialCompanyName = me?.displayName ?? "";

  const t = await getTranslations({ locale, namespace: "Onboarding" });

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 gradient-mesh"
      />

      <div className="w-full max-w-2xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link href="/">
            <Logo />
          </Link>
          <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
            <span className="truncate">{session.user.email}</span>
            <span
              aria-hidden
              className="h-1 w-1 shrink-0 rounded-full bg-[var(--color-border)]"
            />
            <span className="inline-flex shrink-0 items-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-2.5 py-0.5 text-[11px] font-semibold text-white">
              {t("trialLabel")}
            </span>
          </div>
        </div>

        <div className="rounded-3xl border border-[var(--color-border)] bg-white/85 p-7 shadow-lg backdrop-blur sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
            {t("sectionHeader")}
          </p>
          <h1 className="mt-3 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
            {t("title")}
          </h1>
          <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">
            {t("subtitle")}
          </p>

          <div className="mt-8">
            <OnboardingWizard
              initialLanguage={initialLanguage}
              initialCompanyName={initialCompanyName}
              defaultCountry={defaultCountry}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
