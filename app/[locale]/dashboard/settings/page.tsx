import { eq } from "drizzle-orm";
import { getLocale } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { phoneNumbers, users } from "@/lib/db/schema";
import { getLocalizedPlan } from "@/lib/plan-i18n";

import { DeleteAccountSection } from "./delete-account-section";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [me] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!me) redirect("/login");

  if (!me.emailVerified) {
    redirect(`/verify-email?email=${encodeURIComponent(me.email)}`);
  }

  const numbers = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, me.id));

  const locale = await getLocale();
  const plan = getLocalizedPlan(locale, me.subscriptionPlan);
  const isAdmin = me.role === "admin";

  return (
    <main>
      <section className="mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6 sm:pt-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
          Paramètres
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
          Mon compte
        </h1>
        <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">
          Gère ton compte, ta facturation et tes données personnelles.
        </p>
      </section>

      <section className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8 sm:px-6 sm:py-10">
        {/* Profil */}
        <div className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm sm:p-6">
          <h2 className="font-display text-lg text-[var(--color-foreground)]">
            Profil
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-muted-foreground)]">Email</dt>
              <dd className="text-right font-medium text-[var(--color-foreground)]">
                {me.email}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-muted-foreground)]">Nom</dt>
              <dd className="text-right text-[var(--color-foreground)]">
                {me.displayName || "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-muted-foreground)]">Rôle</dt>
              <dd className="text-right capitalize text-[var(--color-foreground)]">
                {me.role}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-muted-foreground)]">
                Inscription
              </dt>
              <dd className="text-right text-[var(--color-foreground)]">
                {new Date(me.createdAt).toLocaleDateString("fr-FR", {
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
                Abonnement
              </h2>
              <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                Formule actuelle :{" "}
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
              Gérer
            </Link>
          </div>
        </div>

        {/* Numéros */}
        {numbers.length > 0 && (
          <div className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-display text-lg text-[var(--color-foreground)]">
              Numéros de téléphone
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
          <h2 className="font-display text-lg text-red-900">Zone dangereuse</h2>
          <p className="mt-1 text-sm text-red-800/80">
            Supprimer ton compte est définitif. Tes données (config, appels,
            contacts, RDV via l&apos;app) seront effacées et tes numéros Twilio
            libérés. Action irréversible.
          </p>
          {isAdmin ? (
            <p className="mt-4 rounded-lg bg-white/60 px-3 py-2 text-xs text-red-800 ring-1 ring-inset ring-red-200">
              ⚠️ En tant qu&apos;admin, tu ne peux pas te self-supprimer
              depuis ce menu (risque de lock-out de l&apos;instance). Demande
              à un autre admin de te supprimer via le panneau /admin.
            </p>
          ) : (
            <DeleteAccountSection email={me.email} />
          )}
        </div>
      </section>
    </main>
  );
}
