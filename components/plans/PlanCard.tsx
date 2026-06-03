"use client";

// Shared plan card — single source of truth for the pricing boxes rendered on
// BOTH the public landing (components/marketing/Pricing.tsx) and the dashboard
// billing page (app/[locale]/dashboard/billing/client.tsx). The two used to
// have separate, drifted copies; this is the unified visual.
//
// The card body (theme, animated tier icon, price, features, overage badge,
// bestFor, model line) is identical everywhere. The differences are passed in:
//   - `action`  : the CTA — a signup <Link> (landing) or a button with
//                 pending/disabled state (billing → opens the HYP payment modal)
//   - `status`  : billing-only highlight — "current" (active plan) or "hinted"
//   - `quote`   : render "sur mesure" instead of a price (landing premium tier)
// Currency selection (the EUR/USD/ILS dropdown) stays in the landing wrapper;
// billing is locale-fixed since you pay in your billing currency.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Link } from "@/i18n/navigation";
import { OVERAGE_RATE_ILS_PER_MIN, type Plan } from "@/lib/plans";
import { resolvePrice, type PlanPricingMap } from "@/lib/plan-pricing";

export type Currency = "EUR" | "USD" | "ILS";

// Symbol + locale (pour Intl.NumberFormat) par devise. La locale détermine
// la position du symbole (avant/après) et le séparateur de milliers.
export const CURRENCY_META: Record<Currency, { symbol: string; locale: string }> = {
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

export function useExchangeRates(): Record<Currency, number> {
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

/**
 * Formate un montant de plan en respectant les devises réellement facturées :
 * EUR et ILS sont des prix admin EXACTS (mêmes que le checkout), USD est une
 * estimation marketing convertie depuis l'EUR via le taux FX. `eur`/`ils` sont
 * les montants admin pour la vue concernée (mensuel, annuel/12, ou total).
 */
function formatPlanMoney(
  eur: number,
  ils: number,
  currency: Currency,
  rates: Record<Currency, number>,
): string {
  const amount =
    currency === "EUR" ? eur : currency === "ILS" ? ils : eur * rates.USD;
  const { locale } = CURRENCY_META[currency];
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

/**
 * Formate un petit montant (overage à la minute) avec 2 décimales.
 * Source = shekel ; conversion via rates EUR-base : `amountIls / rates.ILS`
 * donne le montant équivalent en EUR, puis on multiplie par `rates[target]`.
 */
function formatPricePerMinute(
  amountIls: number,
  currency: Currency,
  rates: Record<Currency, number>,
): string {
  const amountEur = amountIls / rates.ILS;
  const converted = amountEur * rates[currency];
  const { locale } = CURRENCY_META[currency];
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(converted);
}

/** Mapping locale → devise par défaut. FR→EUR, HE→ILS, EN→USD. */
export const LOCALE_TO_CURRENCY: Record<string, Currency> = {
  fr: "EUR",
  he: "ILS",
  en: "USD",
};

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
  const excludedFeatures = (() => {
    try {
      const raw = t.raw(`${plan.key}.excludedFeatures`);
      return Array.isArray(raw) ? (raw as string[]) : plan.excludedFeatures;
    } catch { return plan.excludedFeatures; }
  })();
  const bestFor = (() => {
    try { return t(`${plan.key}.bestFor`); } catch { return plan.bestFor; }
  })();
  return { name, tagline, features, excludedFeatures, bestFor };
}

export type Billing = "monthly" | "annual";

function CheckIcon({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} style={style}>
      <circle cx="10" cy="10" r="10" fill="currentColor" fillOpacity="0.14" />
      <path
        d="m6 10.5 2.5 2.5L14 7.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function XMarkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <circle cx="10" cy="10" r="10" fill="currentColor" fillOpacity="0.10" />
      <path
        d="m7 7 6 6m0-6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Animated tier icons — one per plan, with subtle loop animation     */
/* ------------------------------------------------------------------ */

/** Phone icon with concentric pulse rings (incoming call vibe). */
function PhoneIcon() {
  return (
    <div className="relative inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#22d3ee] to-[#0e7490] text-white shadow-lg shadow-[#22d3ee]/35">
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-2xl ring-2 ring-[#22d3ee]"
        initial={{ scale: 1, opacity: 0.6 }}
        animate={{ scale: 1.4, opacity: 0 }}
        transition={{
          duration: 1.8,
          repeat: Infinity,
          ease: "easeOut",
        }}
      />
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-2xl ring-2 ring-[#22d3ee]"
        initial={{ scale: 1, opacity: 0.5 }}
        animate={{ scale: 1.7, opacity: 0 }}
        transition={{
          duration: 1.8,
          delay: 0.6,
          repeat: Infinity,
          ease: "easeOut",
        }}
      />
      <svg viewBox="0 0 24 24" fill="none" className="relative h-6 w-6">
        <path
          d="M5.5 3.5h3.2l1.8 4.5-2.2 1.1a12 12 0 0 0 6.6 6.6l1.1-2.2 4.5 1.8v3.2a2 2 0 0 1-2 2A15 15 0 0 1 3.5 5.5a2 2 0 0 1 2-2Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/** Headset icon with rotating conic gradient ring (premium receptionist). */
function HeadsetIcon() {
  return (
    <div className="relative inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#be185d] via-[#ec4899] to-[#f472b6] text-white shadow-lg shadow-[#be185d]/40">
      {/* Rotating gradient ring */}
      <motion.span
        aria-hidden
        className="absolute -inset-[3px] rounded-[20px] opacity-70"
        style={{
          background:
            "conic-gradient(from 0deg, #22d3ee, #ec4899, #be185d, #f472b6, #22d3ee)",
          maskImage:
            "radial-gradient(circle at center, transparent 56%, black 60%)",
          WebkitMaskImage:
            "radial-gradient(circle at center, transparent 56%, black 60%)",
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
      />
      <svg viewBox="0 0 24 24" fill="none" className="relative h-6 w-6">
        <path
          d="M4 14a8 8 0 1 1 16 0v3.5a2 2 0 0 1-2 2h-2v-6h4M4 14v3.5a2 2 0 0 0 2 2h2v-6H4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <circle cx="10.5" cy="10.5" r="0.8" fill="currentColor" />
        <circle cx="13.5" cy="10.5" r="0.8" fill="currentColor" />
      </svg>
    </div>
  );
}

/** Tower / building icon with 3 blinking activity dots (multi-call call center). */
function TowerIcon() {
  const reduce = useReducedMotion();
  return (
    <div className="relative inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#be185d] via-[#fb7185] to-[#f59e0b] text-white shadow-lg shadow-[#fb7185]/40">
      {[0, 0.3, 0.6].map((delay, i) => {
        const positions: Array<{ top?: string; bottom?: string; left?: string; right?: string }> = [
          { top: "6px", right: "6px" },
          { top: "6px", left: "6px" },
          { bottom: "6px", right: "6px" },
        ];
        return (
          <motion.span
            key={i}
            aria-hidden
            className="absolute h-1.5 w-1.5 rounded-full bg-white"
            style={positions[i]}
            animate={reduce ? undefined : { opacity: [0.2, 1, 0.2] }}
            transition={{ duration: 1.4, delay, repeat: Infinity }}
          />
        );
      })}
      <svg viewBox="0 0 24 24" fill="none" className="relative h-6 w-6">
        <path
          d="M3 21V8l9-5 9 5v13M3 21h18M9.5 21v-6h5v6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Per-tier theme — accents, gradients, shadows, icon                 */
/* ------------------------------------------------------------------ */

type TierTheme = {
  accent: string;
  accentSoft: string;
  gradient: string;
  ctaGradient: string;
  haloFrom: string;
  haloVia: string;
  haloTo: string;
  ringShadow: string;
  borderColor: string;
  icon: () => React.ReactElement;
};

const TIER_THEME: Record<Plan["key"], TierTheme> = {
  whatsapp: {
    accent: "#0E7490",
    accentSoft: "#22D3EE",
    gradient: "from-[#22d3ee] to-[#0e7490]",
    ctaGradient: "from-[#0e7490] via-[#22d3ee] to-[#67e8f9]",
    haloFrom: "rgba(34,211,238,0.18)",
    haloVia: "rgba(103,232,249,0.08)",
    haloTo: "rgba(255,255,255,0)",
    ringShadow:
      "0 24px 60px -20px rgba(14,116,144,0.30), 0 8px 24px -8px rgba(34,211,238,0.18)",
    borderColor: "rgba(34,211,238,0.40)",
    icon: PhoneIcon,
  },
  global: {
    accent: "#BE185D",
    accentSoft: "#EC4899",
    gradient: "from-[#be185d] via-[#ec4899] to-[#f472b6]",
    ctaGradient: "from-[#be185d] via-[#ec4899] to-[#f472b6]",
    haloFrom: "rgba(236,72,153,0.20)",
    haloVia: "rgba(251,113,133,0.14)",
    haloTo: "rgba(34,211,238,0.10)",
    ringShadow:
      "0 24px 60px -20px rgba(190,24,93,0.40), 0 8px 24px -8px rgba(236,72,153,0.25)",
    borderColor: "rgba(236,72,153,0.55)",
    icon: HeadsetIcon,
  },
  premium: {
    accent: "#BE185D",
    accentSoft: "#FB7185",
    gradient: "from-[#be185d] via-[#fb7185] to-[#f59e0b]",
    ctaGradient: "from-[#be185d] via-[#fb7185] to-[#f59e0b]",
    haloFrom: "rgba(251,113,133,0.20)",
    haloVia: "rgba(245,158,11,0.12)",
    haloTo: "rgba(190,24,93,0.10)",
    ringShadow:
      "0 24px 60px -20px rgba(251,113,133,0.35), 0 8px 24px -8px rgba(245,158,11,0.20)",
    borderColor: "rgba(251,113,133,0.45)",
    icon: TowerIcon,
  },
};

/* ------------------------------------------------------------------ */
/*  Card CTA — link (landing) or button (billing payment modal)        */
/* ------------------------------------------------------------------ */

export type PlanCardAction =
  | { kind: "link"; href: string; label: string; ariaLabel?: string }
  | {
      kind: "button";
      label: string;
      onClick: () => void;
      pending?: boolean;
      disabled?: boolean;
    };

/** Billing-only highlight states. Landing always passes `null`. */
export type PlanCardStatus = "current" | "hinted" | null;

export function PlanCard({
  plan,
  billing,
  currency,
  rates,
  pricing,
  action,
  status = null,
  currentBadgeLabel,
  quote = false,
}: {
  plan: Plan;
  billing: Billing;
  currency: Currency;
  rates: Record<Currency, number>;
  pricing: PlanPricingMap;
  action: PlanCardAction;
  status?: PlanCardStatus;
  /** Label of the "current plan" badge — required when status === "current". */
  currentBadgeLabel?: string;
  /** Render "sur mesure" instead of a price (landing premium tier). */
  quote?: boolean;
}) {
  const t = useTranslations("Pricing.card");
  const localized = useLocalizedPlan(plan);
  // Montants admin (EUR + ILS) pour la vue courante. Mensuel = prix mensuel ;
  // annuel = total annuel ÷ 12 (la grosse valeur reste un équivalent /mois).
  const eurMonthly = resolvePrice(pricing, plan.key, "monthly", "EUR");
  const eurAnnual = resolvePrice(pricing, plan.key, "annual", "EUR");
  const ilsMonthly = resolvePrice(pricing, plan.key, "monthly", "ILS");
  const ilsAnnual = resolvePrice(pricing, plan.key, "annual", "ILS");
  const bigEur = billing === "monthly" ? eurMonthly : eurAnnual / 12;
  const bigIls = billing === "monthly" ? ilsMonthly : ilsAnnual / 12;
  const formattedPrice = formatPlanMoney(bigEur, bigIls, currency, rates);
  const overagePrice = formatPricePerMinute(
    OVERAGE_RATE_ILS_PER_MIN,
    currency,
    rates,
  );
  const annualHint =
    billing === "annual"
      ? t("annualHint", {
          total: formatPlanMoney(eurAnnual, ilsAnnual, currency, rates),
        })
      : null;

  const theme = TIER_THEME[plan.key];
  const TierIcon = theme.icon;

  const isCurrent = status === "current";
  const isHinted = status === "hinted";

  // Border + shadow: "current" (billing) wins over the popular tier emphasis;
  // "hinted" adds an accent ring on top. status === null reduces to the
  // original landing styling (popular → tier border/shadow, else neutral).
  const borderColor = isCurrent
    ? "var(--color-primary)"
    : plan.popular
      ? theme.borderColor
      : "rgba(226,232,240,0.9)";
  const boxShadow = isCurrent
    ? "0 1px 2px rgba(15,23,42,0.04)"
    : plan.popular
      ? theme.ringShadow
      : "0 1px 2px rgba(15,23,42,0.04)";

  return (
    <motion.article
      whileHover={isCurrent ? undefined : { y: -8 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      className={`group relative flex h-full flex-col overflow-hidden rounded-3xl border bg-white/95 p-7 backdrop-blur ${
        isCurrent ? "ring-2 ring-[var(--color-primary)]/15" : ""
      } ${isHinted ? "ring-2 ring-[var(--color-accent)]/40" : ""}`}
      style={{ borderColor, boxShadow }}
    >
      {/* Top gradient accent strip — vivid tier color */}
      <span
        aria-hidden
        className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${theme.gradient}`}
      />

      {/* Soft tier-colored halo behind the card content */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 rounded-3xl"
        style={{
          background: `radial-gradient(120% 70% at 50% 0%, ${theme.haloFrom} 0%, ${theme.haloVia} 35%, ${theme.haloTo} 70%)`,
        }}
      />

      {/* Decorative corner sparkle (subtle, only popular) */}
      {plan.popular && !isCurrent && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(236,72,153,0.30) 0%, transparent 70%)",
          }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      <header className="flex items-start gap-4">
        <TierIcon />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-xl text-[var(--color-foreground)]">
              {localized.name}
            </h3>
            {isCurrent && currentBadgeLabel ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-accent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white shadow-sm">
                {currentBadgeLabel}
              </span>
            ) : plan.popular ? (
              <motion.span
                className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#be185d] via-[#ec4899] to-[#f472b6] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white shadow-sm"
                animate={{
                  boxShadow: [
                    "0 4px 12px -4px rgba(236,72,153,0.45)",
                    "0 4px 16px -2px rgba(34,211,238,0.45)",
                    "0 4px 12px -4px rgba(236,72,153,0.45)",
                  ],
                }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              >
                <motion.svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-2.5 w-2.5"
                  animate={{ rotate: [0, 12, -8, 0] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                >
                  <path d="m10 1.5 2.4 5.5 6 .6-4.5 4 1.3 5.9L10 14.6l-5.2 2.9 1.3-5.9-4.5-4 6-.6L10 1.5Z" />
                </motion.svg>
                {t("popular")}
              </motion.span>
            ) : null}
          </div>
          <p className="mt-1 text-sm leading-snug text-[var(--color-muted-foreground)]">
            {localized.tagline}
          </p>
        </div>
      </header>

      <div className="mt-6">
        {quote ? (
          // Plan custom : pas de prix figé, devis sur mesure
          <>
            <div className="flex items-baseline gap-2">
              <motion.span
                key={`${plan.key}-custom`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="bg-gradient-to-r from-[#be185d] via-[#fb7185] to-[#f59e0b] bg-clip-text font-display text-5xl tracking-tight text-transparent"
              >
                {t("custom")}
              </motion.span>
            </div>
            <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
              {t("customHint")}
            </p>
          </>
        ) : (
          <>
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
            <p
              className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{
                backgroundColor: `${theme.accent}12`,
                color: theme.accent,
              }}
            >
              <svg viewBox="0 0 14 14" fill="none" className="h-3 w-3">
                <path
                  d="M7 1v12M1 7h12"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              {t("overage", { price: overagePrice })}
            </p>
          </>
        )}
      </div>

      <ul className="mt-6 space-y-3 border-t border-[var(--color-border)]/70 pt-6">
        {localized.features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-3 text-sm leading-relaxed text-[var(--color-foreground)]"
          >
            <CheckIcon
              className="mt-0.5 h-5 w-5 shrink-0"
              style={{ color: theme.accent } as React.CSSProperties}
            />
            <span>{f}</span>
          </li>
        ))}
        {localized.excludedFeatures.map((f) => (
          <li
            key={`excluded-${f}`}
            className="flex items-start gap-3 text-sm leading-relaxed text-[var(--color-muted-foreground)]"
          >
            <XMarkIcon className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
            <span className="line-through decoration-slate-300/80">{f}</span>
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
        {action.kind === "link" ? (
          <Link
            href={action.href}
            aria-label={action.ariaLabel ?? action.label}
            className={`cta-shine group/cta relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r ${theme.ctaGradient} px-5 py-3 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.03] hover:shadow-xl active:scale-[0.97]`}
            style={{ boxShadow: `0 10px 24px -10px ${theme.accent}80` }}
          >
            <CtaInner label={action.label} />
          </Link>
        ) : action.disabled ? (
          <button
            type="button"
            disabled
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--color-primary)] bg-[var(--color-muted)] px-5 py-3 text-sm font-medium text-[var(--color-foreground)]"
          >
            {action.label}
          </button>
        ) : (
          <button
            type="button"
            disabled={action.pending}
            onClick={action.onClick}
            className={`cta-shine group/cta relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r ${theme.ctaGradient} px-5 py-3 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.03] hover:shadow-xl active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100`}
            style={{ boxShadow: `0 10px 24px -10px ${theme.accent}80` }}
          >
            <CtaInner label={action.label} />
          </button>
        )}
        <p className="mt-3 text-center text-[11px] text-[var(--color-muted-foreground)]">
          {t("model")} <span className="font-mono">{plan.model}</span>
        </p>
      </div>
    </motion.article>
  );
}

/** Shared CTA inner content — shine sweep + label + arrow. */
function CtaInner({ label }: { label: string }) {
  return (
    <>
      {/* Shine sweep on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover/cta:translate-x-full"
      />
      <span className="relative">{label}</span>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className="relative h-3.5 w-3.5 transition-transform group-hover/cta:translate-x-0.5"
      >
        <path
          d="M3 8h10M9 4l4 4-4 4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </>
  );
}
