"use client";

import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  type Billing,
  PlanCard,
  useExchangeRates,
} from "@/components/plans/PlanCard";
import {
  currencySymbol,
  resolvePrice,
  type PlanPricingMap,
} from "@/lib/plan-pricing";
import { currencyForLocale } from "@/lib/hyp";
import { type Plan, type PlanKey, formatEuro } from "@/lib/plans";

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

export function BillingClient({
  plans,
  pricing,
  currentPlanKey,
  hintedPlanKey,
  initialBilling,
  setPlanAction,
}: {
  plans: Plan[];
  pricing: PlanPricingMap;
  currentPlanKey: PlanKey;
  hintedPlanKey: PlanKey | null;
  initialBilling: Billing;
  setPlanAction: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("DashboardBilling");
  const locale = useLocale();
  const currency = currencyForLocale(locale);
  const rates = useExchangeRates();
  const [billing, setBilling] = useState<Billing>(initialBilling);
  // Kept to preserve the setPlanAction prop contract without breaking callers.
  const [, startTransition] = useTransition();
  const search = useSearchParams();
  // Modal de paiement HYP (iframe). payPlan = plan dont le popup est ouvert ;
  // payPeriod = mensuel/annuel choisi DANS le popup (init depuis le toggle de
  // la page). Changer l'un ou l'autre re-crée une commande + recharge l'iframe.
  const [payPlan, setPayPlan] = useState<PlanKey | null>(null);
  const [payPeriod, setPayPeriod] = useState<Billing>(billing);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [payLoading, setPayLoading] = useState(false);
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

  // Ouvre le popup de paiement pour un plan (période = celle du toggle page).
  function openPayment(planKey: PlanKey) {
    setPayError(null);
    setPayUrl(null);
    setPayPeriod(billing);
    setPayPlan(planKey);
  }
  function closePayment() {
    setPayPlan(null);
    setPayUrl(null);
    setPayError(null);
    setPayLoading(false);
  }

  // (Re)crée une commande HYP + charge l'URL iframe quand le plan ou la période
  // du popup change. Chaque appel crée une nouvelle ligne payment_orders
  // (l'ancienne pending expire en 30 min — sans effet).
  useEffect(() => {
    if (!payPlan) return;
    let cancelled = false;
    (async () => {
      setPayLoading(true);
      setPayUrl(null);
      setPayError(null);
      try {
        const res = await fetch("/api/dashboard/hyp/create-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // locale courante → devise du paiement = celle du prix affiché.
          body: JSON.stringify({ plan: payPlan, period: payPeriod, locale }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (data.url) setPayUrl(data.url);
        else setPayError(data.error || "error");
      } catch (e) {
        if (!cancelled) setPayError(String(e));
      } finally {
        if (!cancelled) setPayLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payPlan, payPeriod, locale]);

  const payPlanObj = plans.find((p) => p.key === payPlan) ?? null;

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

      <div className="flex flex-col items-center gap-2">
        <BillingToggle value={billing} onChange={setBilling} />
        <p className="text-[11px] text-[var(--color-muted-foreground)]">
          {t("annualSavings")}
        </p>
      </div>

      {/* Same boxes as the public landing — shared <PlanCard>. The CTA opens
          the HYP payment modal instead of linking to signup, and the active
          plan gets the "current" highlight. */}
      <div className="mx-auto mt-10 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
        {plans.map((plan) => {
          const isCurrent = plan.key === currentPlanKey;
          const status = isCurrent
            ? "current"
            : hintedPlanKey === plan.key
              ? "hinted"
              : null;
          const pending = payPlan === plan.key;
          return (
            <div
              key={plan.key}
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
                status={status}
                currentBadgeLabel={t("currentBadge")}
                action={
                  isCurrent
                    ? {
                        kind: "button",
                        label: t("currentPlanButton"),
                        onClick: () => {},
                        disabled: true,
                      }
                    : {
                        kind: "button",
                        label: pending ? t("processing") : t("subscribeCta"),
                        onClick: () => openPayment(plan.key),
                        pending,
                      }
                }
              />
            </div>
          );
        })}
      </div>

      {payPlan && payPlanObj && (
        <PaymentModal
          planName={payPlanObj.name}
          period={payPeriod}
          onPeriodChange={setPayPeriod}
          priceLabel={`${formatEuro(
            payPeriod === "annual"
              ? resolvePrice(pricing, payPlan, "annual", currency)
              : resolvePrice(pricing, payPlan, "monthly", currency),
          )} ${currencySymbol(currency)}${payPeriod === "annual" ? t("perYearSuffix") : t("perMonthSuffix")}`}
          url={payUrl}
          loading={payLoading}
          error={payError}
          onClose={closePayment}
        />
      )}
    </div>
  );
}

// Popup de paiement : iframe HYP + toggle mensuel/annuel. Le retour HYP casse
// l'iframe vers le top-level (cf. /api/dashboard/hyp/callback), donc un paiement
// réussi recharge la page parente avec ?paid=1 — le modal disparaît de lui-même.
function PaymentModal({
  planName,
  period,
  onPeriodChange,
  priceLabel,
  url,
  loading,
  error,
  onClose,
}: {
  planName: string;
  period: Billing;
  onPeriodChange: (p: Billing) => void;
  priceLabel: string;
  url: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("DashboardBilling");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[88vh] max-h-[780px] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h3 className="font-display text-lg text-[var(--color-foreground)]">
              {planName}
            </h3>
            <p className="mt-0.5 text-sm font-semibold text-[var(--color-primary)]">
              {priceLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-full p-1.5 text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Toggle mensuel / annuel — recharge l'iframe avec le bon montant. */}
        <div className="flex items-center justify-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-muted)]/40 px-5 py-3">
          {(["monthly", "annual"] as const).map((opt) => {
            const active = period === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onPeriodChange(opt)}
                className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-[var(--color-primary)] text-white shadow-sm"
                    : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                }`}
              >
                {opt === "monthly" ? t("monthly") : t("annual")}
              </button>
            );
          })}
        </div>

        <div className="relative flex-1">
          {url && !loading ? (
            <iframe
              key={url}
              src={url}
              title="Paiement HYP"
              allow="payment"
              className="h-full w-full border-0"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-6 text-center">
              {error ? (
                <p className="text-sm text-red-600">{t("paymentFailed")}</p>
              ) : (
                <p className="animate-pulse text-xs uppercase tracking-widest text-[var(--color-muted-foreground)]">
                  {t("processing")}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
