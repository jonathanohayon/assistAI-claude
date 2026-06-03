"use client";

import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import {
  type Billing,
  type Currency,
  CURRENCY_META,
  LOCALE_TO_CURRENCY,
  PlanCard,
  useExchangeRates,
} from "@/components/plans/PlanCard";
import { PLANS } from "@/lib/plans";
import { type PlanPricingMap } from "@/lib/plan-pricing";

function BillingToggle({
  value,
  onChange,
}: {
  value: Billing;
  onChange: (v: Billing) => void;
}) {
  const t = useTranslations("Pricing.billing");
  return (
    <div
      role="tablist"
      aria-label={t("monthly")}
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
            {opt === "monthly" ? t("monthly") : t("annual")}
            {opt === "annual" && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${
                  active
                    ? "bg-white/20 text-white"
                    : "bg-[#fef3c7] text-[#b45309]"
                }`}
              >
                {t("discount")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function CurrencyDropdown({
  value,
  onChange,
}: {
  value: Currency;
  onChange: (c: Currency) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/80 px-4 py-2 text-sm font-medium text-[var(--color-foreground)] shadow-sm backdrop-blur transition-colors hover:bg-white"
      >
        <span className="text-base leading-none">
          {CURRENCY_META[value].symbol}
        </span>
        <span className="tabular-nums">{value}</span>
        <svg
          viewBox="0 0 12 12"
          fill="none"
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="m3 4.5 3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 top-[calc(100%+6px)] z-20 w-32 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-lg"
        >
          {(Object.keys(CURRENCY_META) as Currency[]).map((c) => {
            const selected = c === value;
            return (
              <li key={c}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors ${
                    selected
                      ? "bg-[var(--color-muted)] font-medium text-[var(--color-foreground)]"
                      : "text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
                  }`}
                >
                  <span className="text-base leading-none">
                    {CURRENCY_META[c].symbol}
                  </span>
                  <span className="tabular-nums">{c}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Pricing({ pricing }: { pricing: PlanPricingMap }) {
  const t = useTranslations("Pricing");
  const tCard = useTranslations("Pricing.card");
  const locale = useLocale();
  const [billing, setBilling] = useState<Billing>("monthly");
  // Devise par défaut selon la locale active (FR→EUR, HE→ILS, EN→USD).
  // L'utilisateur peut toujours changer via le dropdown.
  const [currency, setCurrency] = useState<Currency>(
    LOCALE_TO_CURRENCY[locale] ?? "EUR",
  );
  const rates = useExchangeRates();

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
            {t("kicker")}
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[var(--color-foreground)] sm:text-5xl">
            {t("title")}
          </h2>
          <p className="mt-4 text-base text-[var(--color-muted-foreground)] sm:text-lg">
            {t("subtitle")}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="mt-10 flex flex-col items-center gap-3"
        >
          <div className="flex flex-wrap items-center justify-center gap-3">
            <BillingToggle value={billing} onChange={setBilling} />
            <CurrencyDropdown value={currency} onChange={setCurrency} />
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {t("billing.save")}
          </p>
        </motion.div>

        {/*
          Responsive grid optimisée pour 3 plans :
          - mobile (<640px) : 1 colonne pleine largeur, stack vertical
          - tablette ≥640px : la card "popular" prend toute la ligne en haut,
            les 2 autres se partagent 50/50 en dessous (visuellement la
            popular reste mise en avant sans casser l'alignement)
          - desktop ≥1024px : 3 colonnes égales, popular au centre légèrement
            agrandie via `lg:scale-[1.03]`
        */}
        <div className="mx-auto mt-14 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
          {PLANS.map((plan, i) => (
            <motion.div
              key={plan.key}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{
                duration: 0.55,
                delay: i * 0.08,
                ease: [0.16, 1, 0.3, 1],
              }}
              className={
                plan.popular
                  ? "sm:col-span-2 lg:col-span-1 lg:scale-[1.03] lg:z-10"
                  : ""
              }
            >
              <PlanCard
                plan={plan}
                billing={billing}
                currency={currency}
                rates={rates}
                pricing={pricing}
                quote={plan.key === "premium"}
                action={{
                  kind: "link",
                  href: `/signup?plan=${plan.key}&billing=${billing}`,
                  label: tCard("cta"),
                  ariaLabel: tCard("ctaAria", { name: plan.name }),
                }}
              />
            </motion.div>
          ))}
        </div>

        <p className="mt-12 text-center text-xs text-[var(--color-muted-foreground)]">
          {t("footer")}
        </p>
      </div>
    </section>
  );
}
