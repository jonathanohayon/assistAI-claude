"use client";

// The public pricing section on the PRODUCT grid (F3a): one card per base
// product (Réception, Réception multi-sites, Centre d'appels, Connecter vos agents).
// Rendered by components/marketing/Pricing.tsx ONLY when the route says new
// orders are sold (grid "products"); otherwise the page keeps today's plan
// cards. Every number comes from the product catalogue the route serves
// (`products`, fetched once by Pricing.tsx); null = placeholders, no amount.
// Tax wording: exactly the live page's keys (Pricing.card.perMonth,
// Pricing.card.annualHint, Pricing.footer); Pricing.grid carries none.
//
// Nothing here can buy: until P4 (PRODUCT_ORDERS), every card opens SIGN-UP
// through the product's door, never a checkout or billing page. The trial
// lines say what TODAY's sign-up trial is (lib/pricing-grid.ts SIGNUP_TRIAL,
// from lib/trial.ts); the per-product trial is F4.
// The old plans (lib/plans.ts) are no longer read here: billing still uses
// them for existing subscribers.

import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import { CURRENCY_META, landingCurrencyFor } from "@/lib/landing-currency";
import type { CatalogueCurrency, ProductCatalogue } from "@/lib/product-catalogue";
import type { Product } from "@/lib/product-values";
import {
  type Billing,
  catalogueCurrencyOf,
  formatGridMoney,
  formatGridPerMinute,
  GRID_CURRENCIES,
  GRID_PRODUCTS,
  GRID_SIGNUP_HREF,
  gridCard,
  inSignupTrial,
  isAvailable,
  type ProductAvailability,
  SIGNUP_TRIAL,
} from "@/lib/pricing-grid";

function BillingToggle({ value, onChange }: { value: Billing; onChange: (v: Billing) => void }) {
  const t = useTranslations("Pricing.billing");
  const tg = useTranslations("Pricing.grid");
  return (
    <div
      role="tablist"
      aria-label={tg("billingLabel")}
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
            data-billing={opt}
            onClick={() => onChange(opt)}
            className={`relative z-10 inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-colors ${
              active ? "text-white" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            }`}
          >
            {active && (
              <motion.span
                layoutId="billing-pill"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-[#be185d] to-[#db2777] shadow-md"
              />
            )}
            {opt === "monthly" ? t("monthly") : t("annual")}
            {opt === "annual" && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${
                  active ? "bg-white/20 text-white" : "bg-[#fef3c7] text-[#92400e]"
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

function CurrencyDropdown({ value, onChange }: { value: CatalogueCurrency; onChange: (c: CatalogueCurrency) => void }) {
  const t = useTranslations("Pricing.grid");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

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
        aria-label={t("currency")}
        data-currency-button=""
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/80 px-4 py-2 text-sm font-medium text-[var(--color-foreground)] shadow-sm backdrop-blur transition-colors hover:bg-white"
      >
        <span className="text-base leading-none">{CURRENCY_META[value].symbol}</span>
        <span className="tabular-nums">{value}</span>
        <svg viewBox="0 0 12 12" fill="none" aria-hidden className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute end-0 top-[calc(100%+6px)] z-20 w-32 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-lg"
        >
          {GRID_CURRENCIES.map((c) => (
            <li key={c}>
              <button
                type="button"
                role="option"
                aria-selected={c === value}
                data-currency={c}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--color-foreground)] transition-colors ${
                  c === value ? "bg-[var(--color-muted)] font-medium" : "hover:bg-[var(--color-muted)]"
                }`}
              >
                <span className="text-base leading-none">{CURRENCY_META[c].symbol}</span>
                <span className="tabular-nums">{c}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* One small mark per product, in the brand's magenta / cyan (no pink→cyan blend). */
const ICON_PATH: Record<Product, ReactNode> = {
  reception: (
    <path
      d="M5.5 3.5h3.2l1.8 4.5-2.2 1.1a12 12 0 0 0 6.6 6.6l1.1-2.2 4.5 1.8v3.2a2 2 0 0 1-2 2A15 15 0 0 1 3.5 5.5a2 2 0 0 1 2-2Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  ),
  reception_multi: (
    <path d="M3 21V8l9-5 9 5v13M3 21h18M9.5 21v-6h5v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  ),
  sales: (
    <path
      d="M4 12h11m0 0-4-4m4 4-4 4M19 5v14"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  connect: (
    <path
      d="M9 7V3m6 4V3M7 7h10v4a5 5 0 0 1-10 0V7Zm5 9v5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
};
const ICON_TONE: Record<Product, string> = {
  reception: "bg-gradient-to-br from-[#be185d] to-[#db2777] text-white",
  reception_multi: "bg-gradient-to-br from-[#9d174d] to-[#be185d] text-white",
  sales: "bg-gradient-to-br from-[#be185d] to-[#e11d48] text-white",
  connect: "bg-[#0e7490] text-white ring-2 ring-[#22d3ee]/50",
};

/** A grey bar the size of the number it stands for (nothing shifts on arrival). */
function Placeholder({ className }: { className: string }) {
  return (
    <span data-testid="grid-price-placeholder" aria-hidden className={`inline-block animate-pulse rounded-lg bg-[var(--color-muted)] align-middle ${className}`} />
  );
}

function ProductCard({
  product,
  catalogue,
  currency,
  billing,
  available,
}: {
  product: Product;
  catalogue: ProductCatalogue | null;
  currency: CatalogueCurrency;
  billing: Billing;
  available: ProductAvailability;
}) {
  const t = useTranslations("Pricing.grid");
  const tCard = useTranslations("Pricing.card");
  const locale = useLocale();
  // The link is the same with or without prices: sign-up, never a checkout.
  const card = catalogue ? gridCard(catalogue, product, currency, billing) : null;
  const name = t(`products.${product}.name`);
  const money = (n: number) => formatGridMoney(n, currency, locale);
  // Today's sign-up trial (lib/trial.ts) covers Réception only: the other
  // cards neither say "free trial" nor promise one. A product the route says
  // is not available yet is tagged "Bientôt".
  const trial = inSignupTrial(product);
  const soon = !isAvailable(product, available);
  // As the live cards: the per-month figure ("TTC / mois"); annual shows the
  // monthly equivalent and the year's total ("{total} TTC / an").
  const shown = card ? (billing === "annual" ? Math.round(card.price / 12) : card.price) : null;

  return (
    <article
      data-product={product}
      className="relative flex h-full flex-col rounded-3xl border border-[var(--color-border)] bg-white/90 p-6 shadow-[0_18px_50px_-28px_rgba(190,24,93,0.35)] backdrop-blur"
    >
      {/* The icon at the start, the "Bientôt" tag in the opposite top corner
          (flex: mirrored in RTL), so the tag never pushes the name, the price
          or anything below out of line with the other cards. */}
      <div data-card-top="" className="flex items-start justify-between gap-2">
        <span aria-hidden className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-sm ${ICON_TONE[product]}`}>
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
            {ICON_PATH[product]}
          </svg>
        </span>
        {soon && (
          <span data-soon="" className="rounded-full bg-[#fdf2f8] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#9d174d] ring-1 ring-inset ring-[#fbcfe8]">
            {t("soonTag")}
          </span>
        )}
      </div>
      <h3 className="mt-4 font-display text-xl text-[var(--color-foreground)]">{name}</h3>
      <p className="mt-1.5 min-h-[3.75rem] text-sm leading-snug text-[var(--color-muted-foreground)]">{t(`products.${product}.body`)}</p>

      <div className="mt-5 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        {shown !== null ? (
          <span data-price="" className="font-display text-4xl tracking-tight text-[var(--color-foreground)] tabular-nums">
            {money(shown)}
          </span>
        ) : (
          <Placeholder className="h-9 w-24" />
        )}
        <span className="text-xs text-[var(--color-muted-foreground)]">{tCard("perMonth")}</span>
      </div>
      <p data-period-hint="" className="mt-1 min-h-4 text-xs text-[var(--color-muted-foreground)]">
        {billing === "annual" ? (card ? tCard("annualHint", { total: money(card.price) }) : <Placeholder className="h-3 w-28" />) : tCard("monthlyHint")}
      </p>

      <ul className="mt-4 space-y-2 border-t border-[var(--color-border)] pt-4 text-sm">
        <li data-minutes="" className="font-medium text-[var(--color-foreground)]">
          {card ? t("minutes", { minutes: card.minutes }) : <Placeholder className="h-4 w-40" />}
        </li>
        <li data-overage="" className="text-xs text-[var(--color-muted-foreground)]">
          {card ? t("overage", { price: formatGridPerMinute(card.overagePerMin, currency, locale) }) : <Placeholder className="h-3 w-32" />}
        </li>
        <li data-addon="" className="text-xs text-[var(--color-muted-foreground)]">
          {!card ? (
            <Placeholder className="h-3 w-36" />
          ) : card.addon === null ? (
            t("baseOnly")
          ) : (
            // The amount and its period never break apart.
            t.rich(billing === "annual" ? "addonYear" : "addonMonth", {
              price: money(card.addon),
              b: (chunks) => <span className="whitespace-nowrap font-medium text-[var(--color-foreground)]">{chunks}</span>,
            })
          )}
        </li>
      </ul>

      <div className="mt-auto pt-6">
        <Link
          href={GRID_SIGNUP_HREF[product]}
          aria-label={trial ? t("ctaAria", { name }) : t("ctaAccountAria", { name })}
          data-cta={product}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-gradient-to-br from-[#be185d] to-[#db2777] px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2"
        >
          {trial ? t("cta") : t("ctaAccount")}
        </Link>
        <p data-trial-line="" className="mt-2.5 text-center text-[11px] leading-snug text-[var(--color-muted-foreground)]">
          {trial ? t("cardTrial", SIGNUP_TRIAL) : soon ? t("soonLine") : t("notInTrial")}
        </p>
      </div>
    </article>
  );
}

/** The four cards for a catalogue (null = still loading or failed). Exported for the tests. */
export function ProductPricingGrid({
  catalogue,
  currency,
  billing,
  available,
}: {
  catalogue: ProductCatalogue | null;
  currency: CatalogueCurrency;
  billing: Billing;
  available: ProductAvailability;
}) {
  return (
    <div className="mx-auto mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {GRID_PRODUCTS.map((p, i) => (
        <motion.div
          key={p}
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.55, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }}
        >
          <ProductCard product={p} catalogue={catalogue} currency={currency} billing={billing} available={available} />
        </motion.div>
      ))}
    </div>
  );
}

/** The product-grid section (the route's "products" mode). */
export function ProductPricing({ catalogue, available }: { catalogue: ProductCatalogue | null; available: ProductAvailability }) {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const [billing, setBilling] = useState<Billing>("monthly");
  // The landing's currency for the locale (lib/landing-currency.ts: FR and HE
  // → ILS, EN → USD), on the catalogue's two currencies (USD → EUR).
  const [currency, setCurrency] = useState<CatalogueCurrency>(catalogueCurrencyOf(landingCurrencyFor(locale)));

  return (
    <section id="pricing" className="relative overflow-hidden py-24 sm:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(245, 222, 179, 0.18) 0%, rgba(253, 242, 248, 0) 60%), linear-gradient(180deg, #fff8f1 0%, var(--color-background) 70%)",
        }}
      />

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">{t("kicker")}</p>
          <h2 className="mt-3 font-display text-4xl tracking-tight text-[var(--color-foreground)] sm:text-5xl">{t("grid.title")}</h2>
          <p className="mt-4 text-base text-[var(--color-muted-foreground)] sm:text-lg">{t("grid.subtitle")}</p>
          <p data-how="" className="mx-auto mt-5 max-w-xl text-sm text-[var(--color-foreground)]">
            <span className="font-semibold">{t("grid.howLabel")}</span> {t("grid.how")}
          </p>
        </motion.div>

        <div className="mt-8 flex flex-col items-center gap-3">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <BillingToggle value={billing} onChange={setBilling} />
            <CurrencyDropdown value={currency} onChange={setCurrency} />
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)]">{t("billing.save")}</p>
        </div>

        <ProductPricingGrid catalogue={catalogue} currency={currency} billing={billing} available={available} />

        <p data-trial-banner="" className="mx-auto mt-10 flex max-w-xl items-start justify-center gap-2 rounded-2xl border border-[#22d3ee]/40 bg-white/80 px-4 py-3 text-center text-sm font-medium text-[#0e7490] shadow-sm">
          <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#22d3ee]" />
          {t("grid.trial", SIGNUP_TRIAL)}
        </p>
        <p className="mt-6 text-center text-xs text-[var(--color-muted-foreground)]">{t("footer")}</p>
      </div>
    </section>
  );
}
