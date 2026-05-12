"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { type Plan, PLANS } from "@/lib/plans";

type Currency = "EUR" | "USD" | "ILS";

// Symbol + locale (pour Intl.NumberFormat) par devise. La locale détermine
// la position du symbole (avant/après) et le séparateur de milliers.
const CURRENCY_META: Record<Currency, { symbol: string; locale: string }> = {
  EUR: { symbol: "€", locale: "fr-FR" },
  USD: { symbol: "$", locale: "en-US" },
  ILS: { symbol: "₪", locale: "he-IL" },
};

// Fallback rates si le fetch frankfurter.app échoue. Approximation pour
// éviter d'afficher des prix à 0 ou de masquer la card. Mis à jour au
// rebrand (mai 2026) — ces valeurs servent juste de filet de sécurité.
const FALLBACK_RATES: Record<Currency, number> = {
  EUR: 1,
  USD: 1.08,
  ILS: 4.05,
};

const FX_CACHE_KEY = "fx_rates_eur_v1";
const FX_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — les rates ECB bougent peu intra-day

function useExchangeRates(): Record<Currency, number> {
  const [rates, setRates] = useState<Record<Currency, number>>(FALLBACK_RATES);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(FX_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          ts: number;
          rates: Record<Currency, number>;
        };
        if (Date.now() - parsed.ts < FX_CACHE_TTL_MS) {
          setRates(parsed.rates);
          return;
        }
      }
    } catch {
      // sessionStorage indispo (mode privé, etc.) → on fetch fresh
    }

    const ctrl = new AbortController();
    fetch("https://api.frankfurter.app/latest?from=EUR&to=USD,ILS", {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fx http"))))
      .then((data: { rates?: { USD?: number; ILS?: number } }) => {
        const usd = data.rates?.USD;
        const ils = data.rates?.ILS;
        if (typeof usd !== "number" || typeof ils !== "number") return;
        const next: Record<Currency, number> = { EUR: 1, USD: usd, ILS: ils };
        setRates(next);
        try {
          sessionStorage.setItem(
            FX_CACHE_KEY,
            JSON.stringify({ ts: Date.now(), rates: next }),
          );
        } catch {
          // best-effort
        }
      })
      .catch(() => {
        // garde le fallback
      });

    return () => ctrl.abort();
  }, []);

  return rates;
}

function formatPrice(
  amountEur: number,
  currency: Currency,
  rates: Record<Currency, number>,
): string {
  const converted = Math.round(amountEur * rates[currency]);
  const { locale } = CURRENCY_META[currency];
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(converted);
}

// Helpers locaux : pioche les variantes localisées (Plans namespace) avec
// fallback sur les valeurs FR hardcodées dans lib/plans.ts si la clé n'a
// pas (encore) été ajoutée à la locale. Évite un trou visuel si un dev
// oublie de mettre à jour un fichier de locale en ajoutant une feature.
function useLocalizedPlan(plan: Plan) {
  const t = useTranslations("Plans");
  const name = (() => {
    try { return t(`${plan.key}.name`); } catch { return plan.name; }
  })();
  const tagline = (() => {
    try { return t(`${plan.key}.tagline`); } catch { return plan.tagline; }
  })();
  const features = (() => {
    try {
      const raw = t.raw(`${plan.key}.features`);
      return Array.isArray(raw) ? (raw as string[]) : plan.features;
    } catch { return plan.features; }
  })();
  const bestFor = (() => {
    try { return t(`${plan.key}.bestFor`); } catch { return plan.bestFor; }
  })();
  return { name, tagline, features, bestFor };
}

type Billing = "monthly" | "annual";

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

function PlanCard({
  plan,
  billing,
  currency,
  rates,
}: {
  plan: Plan;
  billing: Billing;
  currency: Currency;
  rates: Record<Currency, number>;
}) {
  const t = useTranslations("Pricing.card");
  const localized = useLocalizedPlan(plan);
  const priceEur = billing === "monthly" ? plan.monthly : plan.annualMonthly;
  const formattedPrice = formatPrice(priceEur, currency, rates);
  const annualHint =
    billing === "annual"
      ? t("annualHint", {
          total: formatPrice(plan.annualTotal, currency, rates),
        })
      : null;

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
              {t("popular")}
            </span>
          </div>
        </>
      )}

      <header>
        <h3 className="font-display text-xl text-[var(--color-foreground)]">
          {localized.name}
        </h3>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {localized.tagline}
        </p>
      </header>

      <div className="mt-6">
        <div className="flex items-baseline gap-1">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={`${plan.key}-${billing}-${currency}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="font-display text-5xl tracking-tight text-[var(--color-foreground)]"
            >
              {formattedPrice}
            </motion.span>
          </AnimatePresence>
          <span className="text-sm font-medium text-[var(--color-muted-foreground)]">
            {t("perMonth")}
          </span>
          {currency === "EUR" && (
            <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
              TTC
            </span>
          )}
        </div>
        <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
          {annualHint ?? t("monthlyHint")}
        </p>
      </div>

      <ul className="mt-6 space-y-3 border-t border-[var(--color-border)]/70 pt-6">
        {localized.features.map((f) => (
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

      {localized.bestFor && (
        <p className="mt-5 border-t border-[var(--color-border)]/70 pt-4 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
          <span className="font-semibold text-[var(--color-foreground)]">
            {t("bestForLabel")}
          </span>{" "}
          {localized.bestFor}
        </p>
      )}

      <div className="mt-auto pt-7">
        <Link
          href={`/signup?plan=${plan.key}&billing=${billing}`}
          aria-label={t("ctaAria", { name: localized.name })}
          className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white shadow-md transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]"
        >
          {t("cta")}
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
          {t("model")} <span className="font-mono">{plan.model}</span>
        </p>
      </div>
    </motion.article>
  );
}

export function Pricing() {
  const t = useTranslations("Pricing");
  const [billing, setBilling] = useState<Billing>("monthly");
  const [currency, setCurrency] = useState<Currency>("EUR");
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
