import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { phoneNumbers, users } from "@/lib/db/schema";
import { getLocalizedPlan } from "@/lib/plan-i18n";

import { DeleteAccountSection } from "./delete-account-section";

export const dynamic = "force-dynamic";

export default async function SettingsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);

  const [me] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!me) redirect(`/${locale}/login`);

  if (!me.emailVerified) {
    redirect(`/${locale}/verify-email?email=${encodeURIComponent(me.email)}`);
  }

  const numbers = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, me.id));

  const plan = getLocalizedPlan(locale, me.subscriptionPlan);
  const isAdmin = me.role === "admin";

  const t = await getTranslations({ locale, namespace: "DashboardSettings" });
  const dateLocale = locale === "he" ? "he-IL" : locale === "en" ? "en-US" : "fr-FR";

  return (
    <main>
      <section className="mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6 sm:pt-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
          {t("header")}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
          {t("title")}
        </h1>
        <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">
          {t("subtitle")}
        </p>
      </section>

      <section className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8 sm:px-6 sm:py-10">
        {/* Profil */}
        <div className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm sm:p-6">
          <h2 className="font-display text-lg text-[var(--color-foreground)]">
            {t("profileSection")}
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-muted-foreground)]">{t("profileEmail")}</dt>
              <dd className="text-right font-medium text-[var(--color-foreground)]">
                {me.email}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-muted-foreground)]">{t("profileName")}</dt>
              <dd className="text-right text-[var(--color-foreground)]">
                {me.displayName || "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-muted-foreground)]">{t("profileRole")}</dt>
              <dd className="text-right capitalize text-[var(--color-foreground)]">
                {me.role}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-muted-foreground)]">
                {t("profileSignup")}
              </dt>
              <dd className="text-right text-[var(--color-foreground)]">
                {new Date(me.createdAt).toLocaleDateString(dateLocale, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </dd>
            </div>
          </dl>
        </div>

        {/* Abonnement */}
        <div className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-lg text-[var(--color-foreground)]">
                {t("subscriptionSection")}
              </h2>
              <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                {t("currentPlan")}{" "}
                <span className="font-medium text-[var(--color-foreground)]">
                  {plan.name}
                </span>{" "}
                · {me.subscriptionStatus}
              </p>
            </div>
            <Link
              href="/dashboard/billing"
              className="whitespace-nowrap rounded-full bg-[var(--color-foreground)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--color-primary)]"
            >
              {t("manageButton")}
            </Link>
          </div>
        </div>

        {/* Numéros */}
        {numbers.length > 0 && (
          <div className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-display text-lg text-[var(--color-foreground)]">
              {t("phoneNumbersSection")}
            </h2>
            <ul className="mt-3 space-y-1.5 text-sm">
              {numbers.map((n) => (
                <li
                  key={n.id}
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--color-muted)] px-3 py-1 font-mono text-xs"
                >
                  {n.phoneNumber}
                  {n.label && (
                    <span className="text-[var(--color-muted-foreground)]">
                      · {n.label}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Danger zone */}
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-5 shadow-sm sm:p-6">
          <h2 className="font-display text-lg text-red-900">{t("dangerZone")}</h2>
          <p className="mt-1 text-sm text-red-800/80">
            {t("dangerDesc")}
          </p>
          {isAdmin ? (
            <p className="mt-4 rounded-lg bg-white/60 px-3 py-2 text-xs text-red-800 ring-1 ring-inset ring-red-200">
              {t("adminCannotDelete")}
            </p>
          ) : (
            <DeleteAccountSection email={me.email} />
          )}
        </div>
      </section>
    </main>
  );
}
