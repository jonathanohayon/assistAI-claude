"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

type Plan = {
  name: string;
  tagline: string;
  monthly: number;
  annualTotal: number;
  annualMonthly: number;
  model: string;
  popular?: boolean;
  features: string[];
};

const PLANS: Plan[] = [
  {
    name: "Essentielle",
    tagline: "Pour démarrer en douceur.",
    monthly: 59,
    annualTotal: 590,
    annualMonthly: 49,
    model: "gpt-realtime-mini",
    features: [
      "500 minutes de conversation / mois",
      "Voix naturelle bilingue FR / Hébreu",
      "Prise de rendez-vous vocale",
    ],
  },
  {
    name: "WhatsApp",
    tagline: "Le choix de la majorité des centres.",
    monthly: 99,
    annualTotal: 990,
    annualMonthly: 82,
    model: "gpt-realtime-mini",
    popular: true,
    features: [
      "Tout de la formule Essentielle",
      "800 minutes / mois",
      "Confirmation WhatsApp automatique",
      "Résumé de conversation par email",
    ],
  },
  {
    name: "Globale",
    tagline: "Pour gérer plusieurs centres.",
    monthly: 179,
    annualTotal: 1790,
    annualMonthly: 149,
    model: "gpt-realtime-mini",
    features: [
      "Tout de la formule WhatsApp",
      "1 200 minutes / mois",
      "Agenda Google complet (3 centres)",
      "CRM Google Sheet fourni & synchronisé",
    ],
  },
  {
    name: "Premium Entreprise",
    tagline: "Sans limite, configuration sur mesure.",
    monthly: 299,
    annualTotal: 2990,
    annualMonthly: 249,
    model: "gpt-realtime-1.5",
    features: [
      "Modèle gpt-realtime-1.5 (ultra naturel)",
      "Minutes illimitées",
      "Agenda + CRM complet",
      "WhatsApp + Résumé + historique",
      "Configuration sur mesure & support dédié",
    ],
  },
];

const formatEuro = (n: number): string =>
  n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });

type Billing = "monthly" | "annual";

function BillingToggle({
  value,
  onChange,
}: {
  value: Billing;
  onChange: (v: Billing) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Période de facturation"
      className="relative inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-white/80 p-1 shadow-sm backdrop-blur"
    >
      {(["monthly", "annual"] as const).map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt)}
            className={`relative z-10 inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-colors ${
              active
                ? "text-white"
                : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            }`}
          >
            {active && (
              <motion.span
                layoutId="billing-pill"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] shadow-md"
              />
            )}
            {opt === "monthly" ? "Mensuel" : "Annuel"}
            {opt === "annual" && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${
                  active
                    ? "bg-white/20 text-white"
                    : "bg-[#fef3c7] text-[#b45309]"
                }`}
              >
                −20%
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <circle cx="10" cy="10" r="10" fill="currentColor" fillOpacity="0.12" />
      <path
        d="m6 10.5 2.5 2.5L14 7.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlanCard({ plan, billing }: { plan: Plan; billing: Billing }) {
  const price = billing === "monthly" ? plan.monthly : plan.annualMonthly;
  const annualHint =
    billing === "annual" ? `${formatEuro(plan.annualTotal)} € HT / an` : null;

  return (
    <motion.article
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      className={`relative flex h-full flex-col rounded-3xl border bg-white/90 p-7 backdrop-blur transition-shadow ${
        plan.popular
          ? "border-transparent shadow-[0_24px_60px_-20px_rgba(212,165,116,0.45),0_8px_24px_-8px_rgba(236,72,153,0.18)] ring-1 ring-[#e5c08a]/60"
          : "border-[var(--color-border)] shadow-sm hover:shadow-md"
      }`}
    >
      {plan.popular && (
        <>
          {/* Soft champagne-gold gradient halo to lift the popular card */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 rounded-3xl bg-gradient-to-br from-[#fff7ec] via-white to-[#fdf2f8]"
          />
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[#d4a574] via-[#e5c08a] to-[#b8864e] px-3.5 py-1 text-[11px] font-semibold tracking-wide text-white shadow-md">
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                <path d="m10 1.5 2.4 5.5 6 .6-4.5 4 1.3 5.9L10 14.6l-5.2 2.9 1.3-5.9-4.5-4 6-.6L10 1.5Z" />
              </svg>
              Le plus populaire
            </span>
          </div>
        </>
      )}

      <header>
        <h3 className="font-display text-xl text-[var(--color-foreground)]">
          {plan.name}
        </h3>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {plan.tagline}
        </p>
      </header>

      <div className="mt-6">
        <div className="flex items-baseline gap-1">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={`${plan.name}-${billing}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="font-display text-5xl tracking-tight text-[var(--color-foreground)]"
            >
              {formatEuro(price)} €
            </motion.span>
          </AnimatePresence>
          <span className="text-sm font-medium text-[var(--color-muted-foreground)]">
            HT / mois
          </span>
        </div>
        <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
          {annualHint ?? "Facturation mensuelle, sans engagement."}
        </p>
      </div>

      <ul className="mt-6 space-y-3 border-t border-[var(--color-border)]/70 pt-6">
        {plan.features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-3 text-sm leading-relaxed text-[var(--color-foreground)]"
          >
            <CheckIcon
              className={`mt-0.5 h-5 w-5 shrink-0 ${
                plan.popular
                  ? "text-[#b8864e]"
                  : "text-[var(--color-primary)]"
              }`}
            />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-7">
        <Link
          href="/signup"
          aria-label={`Choisir la formule ${plan.name}`}
          className={`group inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-all ${
            plan.popular
              ? "bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-white shadow-md hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]"
              : "border border-[var(--color-border)] bg-white text-[var(--color-foreground)] hover:border-[var(--color-primary)] hover:bg-[var(--color-muted)]"
          }`}
        >
          Choisir cette formule
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
          >
            <path
              d="M3 8h10M9 4l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        <p className="mt-3 text-center text-[11px] text-[var(--color-muted-foreground)]">
          Modèle <span className="font-mono">{plan.model}</span>
        </p>
      </div>
    </motion.article>
  );
}

export function Pricing() {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <section
      id="pricing"
      className="relative overflow-hidden py-24 sm:py-32"
    >
      {/* Soft champagne / blush backdrop to set the premium tone */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(245, 222, 179, 0.18) 0%, rgba(253, 242, 248, 0) 60%), linear-gradient(180deg, #fff8f1 0%, var(--color-background) 70%)",
        }}
      />

      <div className="mx-auto w-full max-w-6xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
            Tarifs
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[var(--color-foreground)] sm:text-5xl">
            Une formule pour chaque centre.
          </h2>
          <p className="mt-4 text-base text-[var(--color-muted-foreground)] sm:text-lg">
            Tous les plans incluent la voix premium, l&apos;agenda vivant et le
            support technique. Pas d&apos;engagement, annulable à tout moment.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="mt-10 flex flex-col items-center gap-3"
        >
          <BillingToggle value={billing} onChange={setBilling} />
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Économisez{" "}
            <span className="font-semibold text-[#b45309]">20%</span> avec
            l&apos;abonnement annuel.
          </p>
        </motion.div>

        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
          {PLANS.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{
                duration: 0.55,
                delay: i * 0.08,
                ease: [0.16, 1, 0.3, 1],
              }}
              className={plan.popular ? "lg:-my-2" : ""}
            >
              <PlanCard plan={plan} billing={billing} />
            </motion.div>
          ))}
        </div>

        <p className="mt-12 text-center text-xs text-[var(--color-muted-foreground)]">
          Prix HT en euros. TVA applicable selon votre pays. Besoin d&apos;une
          offre sur mesure pour plus de 5 centres ?{" "}
          <a
            href="mailto:hello@prestige.app"
            className="underline underline-offset-2 hover:text-[var(--color-foreground)]"
          >
            Parlons-en
          </a>
          .
        </p>
      </div>
    </section>
  );
}
