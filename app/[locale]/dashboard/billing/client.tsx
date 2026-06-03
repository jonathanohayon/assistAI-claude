"use client";

import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { priceFor, currencySymbol } from "@/lib/billing-pricing";
import { currencyForLocale } from "@/lib/hyp";
import { type Plan, type PlanKey, formatEuro } from "@/lib/plans";

// Pioche les variantes localisées (Plans namespace) avec fallback FR sur
// lib/plans.ts si la clé manque dans la locale active. Identique au
// helper de components/marketing/Pricing.tsx pour cohérence.
function useLocalizedPlan(plan: Plan) {
  const t = useTranslations("Plans");
  const safe = <T,>(getter: () => T, fallback: T): T => {
    try { return getter(); } catch { return fallback; }
  };
  return {
    name: safe(() => t(`${plan.key}.name`), plan.name),
    tagline: safe(() => t(`${plan.key}.tagline`), plan.tagline),
    features: safe(() => {
      const raw = t.raw(`${plan.key}.features`);
      return Array.isArray(raw) ? (raw as string[]) : Array.from(plan.features);
    }, Array.from(plan.features)),
    bestFor: safe(() => t(`${plan.key}.bestFor`), plan.bestFor),
  };
}

type Billing = "monthly" | "annual";

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

function BillingToggle({
  value,
  onChange,
}: {
  value: Billing;
  onChange: (v: Billing) => void;
}) {
  const t = useTranslations("DashboardBilling");
  return (
    <div
      role="tablist"
      aria-label={t("billingToggleAria")}
      className="relative inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-white p-1 shadow-xs"
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
            className={`relative z-10 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "text-white"
                : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            }`}
          >
            {active && (
              <motion.span
                layoutId="billing-pill-dashboard"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] shadow-sm"
              />
            )}
            {opt === "monthly" ? t("monthly") : t("annual")}
            {opt === "annual" && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold tracking-wide ${
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

function PlanCard({
  plan,
  billing,
  currency,
  currentPlanKey,
  hintedPlanKey,
  pending,
  onSubmit,
}: {
  plan: Plan;
  billing: Billing;
  currency: ReturnType<typeof currencyForLocale>;
  currentPlanKey: PlanKey;
  hintedPlanKey: PlanKey | null;
  pending: boolean;
  onSubmit: (key: PlanKey) => void;
}) {
  const t = useTranslations("DashboardBilling");
  const isCurrent = plan.key === currentPlanKey;
  const wasHinted = hintedPlanKey === plan.key;
  const symbol = currencySymbol(currency);
  // priceFor("annual") is the full yearly charge; the big card number stays a
  // monthly-equivalent (annual ÷ 12) to preserve the original layout/meaning.
  const annualTotal = priceFor(plan.key, "annual", currency);
  const price =
    billing === "monthly"
      ? priceFor(plan.key, "monthly", currency)
      : Math.round(annualTotal / 12);
  const localized = useLocalizedPlan(plan);

  return (
    <motion.article
      whileHover={isCurrent ? undefined : { y: -4 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      className={`relative flex h-full flex-col rounded-3xl border bg-white p-6 transition-shadow ${
        isCurrent
          ? "border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/15"
          : plan.popular
          ? "border-transparent shadow-[0_24px_60px_-20px_rgba(212,165,116,0.4),0_8px_24px_-8px_rgba(236,72,153,0.15)] ring-1 ring-[#e5c08a]/60"
          : "border-[var(--color-border)] shadow-sm hover:shadow-md"
      } ${wasHinted && !isCurrent ? "ring-2 ring-[var(--color-accent)]/40" : ""}`}
    >
      {plan.popular && !isCurrent && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 rounded-3xl bg-gradient-to-br from-[#fff7ec] via-white to-[#fdf2f8]"
          />
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-br from-[#d4a574] via-[#e5c08a] to-[#b8864e] px-3 py-1 text-[10px] font-semibold tracking-wide text-white shadow-md">
              {t("popularBadge")}
            </span>
          </div>
        </>
      )}

      {isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-3 py-1 text-[10px] font-semibold tracking-wide text-white shadow-md">
            {t("currentBadge")}
          </span>
        </div>
      )}

      <header>
        <h3 className="font-display text-lg text-[var(--color-foreground)]">
          {localized.name}
        </h3>
        <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
          {localized.tagline}
        </p>
      </header>

      <div className="mt-5">
        <div className="flex items-baseline gap-1">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={`${plan.key}-${billing}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="font-display text-3xl tracking-tight text-[var(--color-foreground)]"
            >
              {formatEuro(price)} {symbol}
            </motion.span>
          </AnimatePresence>
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {t("vatExclMonth")}
          </span>
        </div>
        {billing === "annual" && (
          <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">
            {t("annualTotal", { total: `${formatEuro(annualTotal)} ${symbol}` })}
          </p>
        )}
      </div>

      <ul className="mt-5 space-y-2 border-t border-[var(--color-border)]/70 pt-4">
        {localized.features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-2 text-xs leading-relaxed text-[var(--color-foreground)]"
          >
            <CheckIcon
              className={`mt-0.5 h-4 w-4 shrink-0 ${
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
        <p className="mt-4 border-t border-[var(--color-border)]/70 pt-3 text-[11px] leading-relaxed text-[var(--color-muted-foreground)]">
          <span className="font-semibold text-[var(--color-foreground)]">
            {t("bestFor")}
          </span>{" "}
          {localized.bestFor}
        </p>
      )}

      <div className="mt-auto pt-5">
        {isCurrent ? (
          <button
            type="button"
            disabled
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--color-primary)] bg-[var(--color-muted)] px-4 py-2 text-xs font-medium text-[var(--color-foreground)]"
          >
            {t("currentPlanButton")}
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => onSubmit(plan.key)}
            className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2 text-xs font-medium text-white shadow-md transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? t("processing") : t("subscribeCta")}
            <svg
              viewBox="0 0 16 16"
              fill="none"
              className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
            >
              <path
                d="M3 8h10M9 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        <p className="mt-2 text-center text-[10px] text-[var(--color-muted-foreground)]">
          {t("modelLabel")} <span className="font-mono">{plan.model}</span>
        </p>
      </div>
    </motion.article>
  );
}

export function BillingClient({
  plans,
  currentPlanKey,
  hintedPlanKey,
  initialBilling,
  setPlanAction,
}: {
  plans: Plan[];
  currentPlanKey: PlanKey;
  hintedPlanKey: PlanKey | null;
  initialBilling: Billing;
  setPlanAction: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("DashboardBilling");
  const locale = useLocale();
  const currency = currencyForLocale(locale);
  const [billing, setBilling] = useState<Billing>(initialBilling);
  // Kept to preserve the setPlanAction prop contract without breaking callers.
  const [, startTransition] = useTransition();
  const search = useSearchParams();
  const [processingPlan, setProcessingPlan] = useState<PlanKey | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  const flash = (() => {
    const paid = search.get("paid");
    const payment = search.get("payment");
    if (paid === "1")
      return { kind: "ok" as const, msg: t("paymentSuccess") };
    if (payment === "failed")
      return { kind: "err" as const, msg: t("paymentFailed") };
    if (payment === "cancelled")
      return { kind: "info" as const, msg: t("paymentCancelled") };

    const changed = search.get("changed");
    const same = search.get("same");
    const error = search.get("error");
    if (changed) return { kind: "ok" as const, msg: t("flashChanged", { plan: changed }) };
    if (same) return { kind: "info" as const, msg: t("flashSame") };
    if (error) return { kind: "err" as const, msg: t("flashError") };
    return null;
  })();

  // Preserves the legacy server-action prop; no longer wired to the visible CTA.
  const submit = (key: PlanKey) => {
    const fd = new FormData();
    fd.set("plan", key);
    startTransition(() => setPlanAction(fd));
  };
  void submit;

  async function startPayment(planKey: PlanKey) {
    setPayError(null);
    setProcessingPlan(planKey);
    try {
      const res = await fetch("/api/dashboard/hyp/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: planKey,
          period: billing === "annual" ? "annual" : "monthly",
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setPayError(data.error || "error");
      setProcessingPlan(null);
    } catch (e) {
      setPayError(String(e));
      setProcessingPlan(null);
    }
  }

  return (
    <div className="mt-8">
      {flash && (
        <p
          role="status"
          className={`mb-6 rounded-xl border px-4 py-2.5 text-xs ${
            flash.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : flash.kind === "err"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-[var(--color-border)] bg-white text-[var(--color-muted-foreground)]"
          }`}
        >
          {flash.msg}
        </p>
      )}

      {payError && (
        <p
          role="alert"
          className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700"
        >
          {t("paymentFailed")}
        </p>
      )}

      <div className="flex flex-col items-center gap-2">
        <BillingToggle value={billing} onChange={setBilling} />
        <p className="text-[11px] text-[var(--color-muted-foreground)]">
          {t("annualSavings")}
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => (
          <PlanCard
            key={plan.key}
            plan={plan}
            billing={billing}
            currency={currency}
            currentPlanKey={currentPlanKey}
            hintedPlanKey={hintedPlanKey}
            pending={processingPlan === plan.key}
            onSubmit={startPayment}
          />
        ))}
      </div>
    </div>
  );
}
