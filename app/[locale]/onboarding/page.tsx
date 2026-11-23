import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { agentConfigs, phoneNumbers, users } from "@/lib/db/schema";
import { getAccountDoor } from "@/lib/door";
import { onboardingScreen, previewHref } from "@/lib/onboarding-route";
import { accountProducts } from "@/lib/products";
import { publicOffer } from "@/lib/public-offer";
import { TRIAL_COPY_VALUES } from "@/lib/trial-copy";

import { DoorWelcome } from "./door-welcome";
import { OnboardingHeader } from "./onboarding-header";
import { WizardCard } from "./wizard-card";

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

  // The door decides the first screen (lib/onboarding-route.ts). Reception,
  // no door, or a usable product: the wizard, exactly as before. A sales or
  // connect door whose product is not usable yet: the welcome screen, and no
  // number is searched or bought unless the account opens the wizard itself.
  const door = await getAccountDoor(session.user.id);
  let welcome: ReactNode = null;
  if (door !== "reception" && onboardingScreen(door, publicOffer().available) === "welcome") {
    const { notifyRequested } = await accountProducts(session.user.id);
    welcome = (
      <DoorWelcome
        door={door}
        previewHref={previewHref(door)}
        notifyRecorded={notifyRequested.includes(door)}
        initialCompanyName={initialCompanyName}
        initialLanguage={isLang(locale) ? locale : "fr"}
        defaultCountry={defaultCountry}
        email={session.user.email}
        trialLabel={t("trialLabel", TRIAL_COPY_VALUES)}
      />
    );
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 gradient-mesh"
      />

      <div className="w-full max-w-2xl">
        {welcome ?? (
          <>
            <OnboardingHeader
              email={session.user.email}
              trialLabel={t("trialLabel", TRIAL_COPY_VALUES)}
            />
            <WizardCard
              sectionHeader={t("sectionHeader")}
              title={t("title")}
              subtitle={t("subtitle")}
              initialLanguage={initialLanguage}
              initialCompanyName={initialCompanyName}
              defaultCountry={defaultCountry}
            />
          </>
        )}
      </div>
    </main>
  );
}
