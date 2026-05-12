"use client";

import Link from "next/link";
import { useState } from "react";

import { Logo } from "@/components/ui/Logo";
import {
  type Plan,
  type PlanKey,
  PLANS,
  planByKey,
} from "@/lib/plans";

interface SignupContentProps {
  initialPlanKey: PlanKey;
  billingMode: "monthly" | "annual";
  error: string | undefined;
  handleSignup: (formData: FormData) => Promise<void>;
}

const ERROR_MSG: Record<string, string> = {
  invalid: "Email invalide ou mot de passe trop court (8 caractères min).",
  exists: "Un compte existe déjà avec cet email.",
};

/**
 * Page signup full-client : le state de la formule sélectionnée est partagé
 * entre la card recap (gauche) et le picker (droite). Quand l'user change
 * de radio → la card gauche se met à jour instantanément (nom, prix,
 * features). handleSignup reste un server action passé en prop, le radio
 * input garde le name="plan" pour que le formData soit propre.
 */
export function SignupContent({
  initialPlanKey,
  billingMode,
  error,
  handleSignup,
}: SignupContentProps) {
  const [selectedKey, setSelectedKey] = useState<PlanKey>(initialPlanKey);
  const selectedPlan: Plan = planByKey(selectedKey);
  const monthlyPrice =
    billingMode === "annual"
      ? selectedPlan.annualMonthly
      : selectedPlan.monthly;

  return (
    <div className="grid w-full max-w-4xl gap-6 lg:grid-cols-[1.1fr_1fr] lg:gap-8">
      {/* Plan recap (mobile shows it above the form) */}
      <aside className="order-2 lg:order-1">
        <div className="sticky top-8 rounded-3xl border border-[var(--color-border)] bg-white/90 p-6 shadow-md backdrop-blur sm:p-7">
          <div className="flex items-center justify-between">
            <Link href="/" className="inline-block">
              <Logo />
            </Link>
            {selectedPlan.key === "whatsapp" && (
              <span
                aria-label="WhatsApp"
                title="Notifications WhatsApp incluses"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#25D366] text-white shadow-sm"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.93 9.93 0 0 0 4.73 1.2h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01ZM12.04 20.15h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.18 8.18 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.42 5.82c0 4.54-3.7 8.23-8.25 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.7-.8-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-2-1.23a7.5 7.5 0 0 1-1.39-1.73c-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.13-.14.16-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.77-1.84-.2-.49-.41-.42-.56-.42l-.48-.01c-.16 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.21.88 2.38 1.01 2.55.12.16 1.74 2.66 4.21 3.73.59.25 1.05.4 1.41.51.59.19 1.13.16 1.55.1.47-.07 1.47-.6 1.68-1.18.2-.58.2-1.07.14-1.18-.05-.1-.21-.16-.46-.28Z" />
                </svg>
              </span>
            )}
          </div>

          <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
            Formule choisie
          </p>
          <h2 className="mt-2 font-display text-2xl tracking-tight text-[var(--color-foreground)]">
            {selectedPlan.name}
            {selectedPlan.popular && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-gradient-to-br from-[#d4a574] to-[#b8864e] px-2 py-0.5 align-middle text-[10px] font-semibold tracking-wide text-white">
                ★ Recommandé
              </span>
            )}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            {selectedPlan.tagline}
          </p>

          <div className="mt-5 flex items-baseline gap-1.5">
            <span className="font-display text-4xl tracking-tight text-[var(--color-foreground)]">
              {monthlyPrice} €
            </span>
            <span className="text-sm text-[var(--color-muted-foreground)]">
              TTC / mois
            </span>
            {billingMode === "annual" && (
              <span className="ml-2 rounded-full bg-[#fef3c7] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[#b45309]">
                −20% annuel
              </span>
            )}
          </div>

          <ul className="mt-6 space-y-2.5 border-t border-[var(--color-border)]/70 pt-5">
            {selectedPlan.features.map((f) => (
              <li
                key={f}
                className="flex items-start gap-2.5 text-sm text-[var(--color-foreground)]"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]"
                >
                  <circle
                    cx="10"
                    cy="10"
                    r="10"
                    fill="currentColor"
                    fillOpacity="0.12"
                  />
                  <path
                    d="m6 10.5 2.5 2.5L14 7.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>{f}</span>
              </li>
            ))}
          </ul>

          <p className="mt-5 rounded-xl bg-[var(--color-muted)] px-3 py-2 text-[11px] text-[var(--color-muted-foreground)]">
            7 jours d&apos;essai gratuit. Sans engagement, changeable depuis le
            dashboard.{" "}
            <Link
              href="/#pricing"
              className="underline underline-offset-2 hover:text-[var(--color-foreground)]"
            >
              Comparer les formules
            </Link>
            .
          </p>
        </div>
      </aside>

      {/* Signup form */}
      <div className="order-1 lg:order-2">
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

          {error && ERROR_MSG[error] && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              {ERROR_MSG[error]}
            </p>
          )}

          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="font-medium text-[var(--color-foreground)]">
              Formule
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {PLANS.map((p) => (
                <label
                  key={p.key}
                  className="relative cursor-pointer rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 transition-all hover:border-[var(--color-primary)]/50 has-[:checked]:border-[var(--color-primary)] has-[:checked]:ring-2 has-[:checked]:ring-[var(--color-primary)]/20"
                >
                  <input
                    type="radio"
                    name="plan"
                    value={p.key}
                    checked={selectedKey === p.key}
                    onChange={() => setSelectedKey(p.key)}
                    className="peer sr-only"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--color-foreground)]">
                      {p.name}
                    </span>
                    {p.popular && (
                      <span className="rounded-full bg-gradient-to-br from-[#d4a574] to-[#b8864e] px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-white">
                        ★
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">
                    {p.monthly} € / mois
                  </div>
                </label>
              ))}
            </div>
          </fieldset>

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
            <span className="font-medium text-[var(--color-foreground)]">
              Email
            </span>
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
              <path
                d="M5 12h14M13 5l7 7-7 7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <p className="text-center text-xs text-[var(--color-muted-foreground)]">
            Déjà un compte ?{" "}
            <Link
              href="/login"
              className="text-[var(--color-primary)] hover:underline"
            >
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
    </div>
  );
}
