"use client";

import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  type Billing,
  PlanCard,
  useExchangeRates,
} from "@/components/plans/PlanCard";
import { currencyForLocale } from "@/lib/hyp";
import {
  currencySymbol,
  resolvePrice,
  type PlanPricingMap,
} from "@/lib/plan-pricing";
import { type Plan, type PlanKey, formatEuro } from "@/lib/plans";
import { classifyChange } from "@/lib/subscription";

import { DeleteAccountSection } from "../settings/delete-account-section";
import CallsPerDayChart from "./charts/CallsPerDayChart";
import { MinutesGauge } from "./charts/MinutesGauge";
import OutcomeDonut from "./charts/OutcomeDonut";
import SpendChart from "./charts/SpendChart";

// ─── Types (mirror /api/dashboard/billing-stats) ────────────────────────────

interface BillingStats {
  plan: PlanKey;
  status: "trialing" | "active" | "cancelled" | "expired";
  period: "monthly" | "annual" | null;
  paidUntil: string | null;
  trialEndsAt: string | null;
  autoRenew: boolean;
  cancelledAt: string | null;
  scheduledPlan: PlanKey | null;
  scheduledPlanPeriod: "monthly" | "annual" | null;
  scheduledPlanAt: string | null;
  card: { last4: string; brand: string | null } | null;
  currency: "ILS" | "EUR";
  window: { start: string; end: string; kind: "trial" | "paid" | "expired" };
  usage: { minutesUsed: number; minutesIncluded: number; overageRateIls: number };
  callsPerDay: { date: string; inbound: number; outbound: number }[];
  outcomes: {
    inboundTotal: number;
    outboundTotal: number;
    campaign: { outcome: string; count: number }[];
  };
  payments: {
    id: string;
    planKey: string;
    period: string;
    currency: string;
    amount: number;
    status: string;
    kind: string;
    paidAt: string | null;
    createdAt: string;
  }[];
}

// ─── BillingToggle ───────────────────────────────────────────────────────────

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
                  active ? "bg-white/20 text-white" : "bg-[#fef3c7] text-[#b45309]"
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

// ─── BillingClient ───────────────────────────────────────────────────────────

export function BillingClient({
  plans,
  pricing,
  currentPlanKey,
  hintedPlanKey,
  initialBilling,
  email,
}: {
  plans: Plan[];
  pricing: PlanPricingMap;
  currentPlanKey: PlanKey;
  hintedPlanKey: PlanKey | null;
  initialBilling: Billing;
  email: string;
}) {
  const t = useTranslations("DashboardBilling");
  const locale = useLocale();
  const currency = currencyForLocale(locale);
  const rates = useExchangeRates();
  const [billing, setBilling] = useState<Billing>(initialBilling);
  const search = useSearchParams();

  const [stats, setStats] = useState<BillingStats | null>(null);
  const [busy, setBusy] = useState(false);

  // Payment modal (HYP iframe) — initial subscription + upgrades.
  const [payPlan, setPayPlan] = useState<PlanKey | null>(null);
  const [payPeriod, setPayPeriod] = useState<Billing>(billing);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/billing-stats");
      if (res.ok) setStats((await res.json()) as BillingStats);
    } catch {
      /* silencieux — la grille de plans reste utilisable sans les stats */
    }
  }, []);
  useEffect(() => {
    // Fetch async au montage : setStats s'exécute après l'await (pas un
    // setState synchrone), c'est le cas légitime "sync depuis un système
    // externe". On désactive la règle qui ne distingue pas l'async.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStats();
  }, [loadStats]);

  const fmtDate = useCallback(
    (iso: string | null) => {
      if (!iso) return "—";
      try {
        return new Intl.DateTimeFormat(locale, {
          day: "2-digit",
          month: "long",
          year: "numeric",
        }).format(new Date(iso));
      } catch {
        return iso.slice(0, 10);
      }
    },
    [locale],
  );

  const flash = (() => {
    const paid = search.get("paid");
    const payment = search.get("payment");
    if (paid === "1") return { kind: "ok" as const, msg: t("paymentSuccess") };
    if (payment === "failed")
      return { kind: "err" as const, msg: t("paymentFailed") };
    if (payment === "cancelled")
      return { kind: "info" as const, msg: t("paymentCancelled") };
    return null;
  })();

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

  // ─ Subscription actions ─
  const post = useCallback(
    async (url: string, body?: unknown) => {
      setBusy(true);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        await res.json().catch(() => ({}));
        await loadStats();
      } finally {
        setBusy(false);
      }
    },
    [loadStats],
  );

  const cancelSub = () => {
    if (typeof window !== "undefined" && !window.confirm(t("cancelConfirm")))
      return;
    void post("/api/dashboard/subscription/cancel");
  };
  const resumeSub = () => void post("/api/dashboard/subscription/resume");
  const scheduleDowngrade = (planKey: PlanKey) => {
    const date = fmtDate(stats?.paidUntil ?? null);
    const planName = plans.find((p) => p.key === planKey)?.name ?? planKey;
    if (
      typeof window !== "undefined" &&
      !window.confirm(t("scheduleConfirm", { plan: planName, date }))
    )
      return;
    void post("/api/dashboard/subscription/schedule-change", {
      plan: planKey,
      period: billing,
    });
  };
  const clearSchedule = () =>
    void post("/api/dashboard/subscription/schedule-change", { plan: null });

  const payPlanObj = plans.find((p) => p.key === payPlan) ?? null;
  const statusLabel = stats
    ? t(
        `status${stats.status.charAt(0).toUpperCase()}${stats.status.slice(1)}` as "statusActive",
      )
    : "";

  return (
    <div className="mt-8 flex flex-col gap-10">
      {flash && (
        <p
          role="status"
          className={`rounded-xl border px-4 py-2.5 text-xs ${
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

      {/* ── Current plan header ─────────────────────────────────────────── */}
      {stats && (
        <CurrentPlanCard
          stats={stats}
          statusLabel={statusLabel}
          planName={plans.find((p) => p.key === stats.plan)?.name ?? stats.plan}
          scheduledPlanName={
            stats.scheduledPlan
              ? (plans.find((p) => p.key === stats.scheduledPlan)?.name ??
                stats.scheduledPlan)
              : null
          }
          fmtDate={fmtDate}
          busy={busy}
          onResume={resumeSub}
          onClearSchedule={clearSchedule}
          t={t}
        />
      )}

      {/* ── Usage ───────────────────────────────────────────────────────── */}
      {stats && (
        <section className="flex flex-col gap-4">
          <SectionTitle title={t("sectionUsage")} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <MinutesGauge
              used={stats.usage.minutesUsed}
              included={stats.usage.minutesIncluded}
              title={t("usageTitle")}
              usedLabel={t("minutesUsedLabel")}
              includedLabel={t("minutesIncludedLabel")}
              overageLabel={t("overageWarning", {
                rate: stats.usage.overageRateIls,
              })}
            />
            <div className="lg:col-span-2">
              <CallsPerDayChart
                data={stats.callsPerDay}
                title={t("callsPerDayTitle")}
                inboundLabel={t("inboundLabel")}
                outboundLabel={t("outboundLabel")}
                emptyLabel={t("chartEmpty")}
              />
            </div>
          </div>
          <OutcomeDonut
            title={t("donutTitle")}
            emptyLabel={t("chartEmpty")}
            data={[
              {
                label: t("inboundLabel"),
                value: stats.outcomes.inboundTotal,
                color: "var(--color-primary)",
              },
              {
                label: t("outboundLabel"),
                value: stats.outcomes.outboundTotal,
                color: "var(--color-accent)",
              },
            ]}
          />
        </section>
      )}

      {/* ── Spend & invoices ────────────────────────────────────────────── */}
      {stats && (
        <section className="flex flex-col gap-4">
          <SectionTitle title={t("sectionSpend")} />
          <SpendChart
            data={stats.payments
              .filter((p) => p.paidAt)
              .map((p) => ({ date: p.paidAt as string, amount: p.amount }))
              .reverse()}
            currencySymbol={currencySymbol(currency)}
            title={t("spendTitle")}
            emptyLabel={t("chartEmpty")}
          />
          <InvoicesTable
            payments={stats.payments}
            planName={(k) => plans.find((p) => p.key === k)?.name ?? k}
            fmtDate={fmtDate}
            t={t}
          />
        </section>
      )}

      {/* ── Payment method ──────────────────────────────────────────────── */}
      {stats && (
        <section className="flex flex-col gap-4">
          <SectionTitle title={t("sectionPaymentMethod")} />
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-white p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-12 items-center justify-center rounded-md bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-[10px] font-bold text-white">
                CARD
              </span>
              <p className="text-sm text-[var(--color-foreground)]">
                {stats.card
                  ? t("cardOnFile", { last4: stats.card.last4 })
                  : t("noCardOnFile")}
              </p>
            </div>
            <p className="text-[11px] text-[var(--color-muted-foreground)]">
              {t("cardManagedNote")}
            </p>
          </div>
        </section>
      )}

      {/* ── Plans grid ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <SectionTitle title={t("sectionPlans")} />
        <div className="flex flex-col items-center gap-2">
          <BillingToggle value={billing} onChange={setBilling} />
          <p className="text-[11px] text-[var(--color-muted-foreground)]">
            {t("annualSavings")}
          </p>
        </div>

        <div className="mx-auto mt-4 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
          {plans.map((plan) => {
            const isCurrent = plan.key === currentPlanKey;
            const change = classifyChange(currentPlanKey, plan.key);
            const status = isCurrent
              ? "current"
              : hintedPlanKey === plan.key
                ? "hinted"
                : null;
            const pending = payPlan === plan.key;
            const isScheduled = stats?.scheduledPlan === plan.key;
            return (
              <div
                key={plan.key}
                className={
                  plan.popular ? "sm:col-span-2 lg:col-span-1 lg:scale-[1.03] lg:z-10" : ""
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
                      : isScheduled
                        ? {
                            kind: "button",
                            label: t("scheduledCancelCta"),
                            onClick: clearSchedule,
                          }
                        : change === "upgrade"
                          ? {
                              kind: "button",
                              label: pending
                                ? t("processing")
                                : t("planUpgradeCta", { plan: plan.name }),
                              onClick: () => openPayment(plan.key),
                              pending,
                            }
                          : {
                              kind: "button",
                              label: t("planDowngradeCta", { plan: plan.name }),
                              onClick: () => scheduleDowngrade(plan.key),
                            }
                  }
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Danger zone ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50/40 p-5">
        <div>
          <h3 className="text-sm font-bold text-[var(--color-destructive)]">
            {t("dangerTitle")}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
            {t("dangerSubtitle")}
          </p>
        </div>
        {stats &&
          (stats.status === "active" || stats.status === "trialing") &&
          (stats.autoRenew ? (
            <button
              type="button"
              onClick={cancelSub}
              disabled={busy}
              className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-4 py-2 text-xs font-medium text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)] disabled:opacity-50"
            >
              {t("cancelSubscription")}
            </button>
          ) : (
            <button
              type="button"
              onClick={resumeSub}
              disabled={busy}
              className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-300 bg-white px-4 py-2 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50"
            >
              {t("resumeSubscription")}
            </button>
          ))}
        <div className="border-t border-red-200 pt-3">
          <p className="text-xs font-semibold text-[var(--color-foreground)]">
            {t("deleteAccountTitle")}
          </p>
          <DeleteAccountSection email={email} />
        </div>
      </section>

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

// ─── Current plan card ───────────────────────────────────────────────────────

function CurrentPlanCard({
  stats,
  statusLabel,
  planName,
  scheduledPlanName,
  fmtDate,
  busy,
  onResume,
  onClearSchedule,
  t,
}: {
  stats: BillingStats;
  statusLabel: string;
  planName: string;
  scheduledPlanName: string | null;
  fmtDate: (iso: string | null) => string;
  busy: boolean;
  onResume: () => void;
  onClearSchedule: () => void;
  t: ReturnType<typeof useTranslations<"DashboardBilling">>;
}) {
  const statusColor =
    stats.status === "active"
      ? "bg-emerald-100 text-emerald-700"
      : stats.status === "trialing"
        ? "bg-blue-100 text-blue-700"
        : stats.status === "cancelled"
          ? "bg-amber-100 text-amber-700"
          : "bg-red-100 text-red-700";

  const dateLine = (() => {
    if (stats.status === "trialing")
      return t("trialEndsOn", { date: fmtDate(stats.trialEndsAt) });
    if (stats.status === "expired")
      return t("expiredOn", { date: fmtDate(stats.paidUntil) });
    if (!stats.autoRenew || stats.cancelledAt)
      return t("accessUntil", { date: fmtDate(stats.paidUntil) });
    return t("renewsOn", { date: fmtDate(stats.paidUntil) });
  })();

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 bg-gradient-to-br from-[var(--color-primary)]/[0.06] to-[var(--color-accent)]/[0.06] p-5">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl text-[var(--color-foreground)]">
              {planName}
            </h2>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusColor}`}
            >
              {statusLabel}
            </span>
          </div>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {dateLine}
          </p>
        </div>
      </div>

      {/* Banners */}
      {scheduledPlanName && stats.scheduledPlanAt && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 bg-amber-50 px-5 py-3">
          <p className="text-xs text-amber-800">
            {t("scheduledBanner", {
              plan: scheduledPlanName,
              date: fmtDate(stats.scheduledPlanAt),
            })}
          </p>
          <button
            type="button"
            onClick={onClearSchedule}
            disabled={busy}
            className="text-xs font-semibold text-amber-900 underline disabled:opacity-50"
          >
            {t("scheduledCancelCta")}
          </button>
        </div>
      )}
      {!stats.autoRenew && stats.cancelledAt && stats.status === "active" && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 bg-amber-50 px-5 py-3">
          <p className="text-xs text-amber-800">
            {t("cancelledBanner", { date: fmtDate(stats.paidUntil) })}
          </p>
          <button
            type="button"
            onClick={onResume}
            disabled={busy}
            className="text-xs font-semibold text-amber-900 underline disabled:opacity-50"
          >
            {t("resumeSubscription")}
          </button>
        </div>
      )}
    </motion.section>
  );
}

// ─── Invoices table ──────────────────────────────────────────────────────────

function InvoicesTable({
  payments,
  planName,
  fmtDate,
  t,
}: {
  payments: BillingStats["payments"];
  planName: (k: string) => string;
  fmtDate: (iso: string | null) => string;
  t: ReturnType<typeof useTranslations<"DashboardBilling">>;
}) {
  if (payments.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-white p-6 text-center text-xs text-[var(--color-muted-foreground)]">
        {t("invoicesEmpty")}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white">
      <table className="w-full text-left text-xs">
        <thead className="bg-[var(--color-muted)]/40 text-[var(--color-muted-foreground)]">
          <tr>
            <th className="px-4 py-2.5 font-semibold">{t("invoiceDate")}</th>
            <th className="px-4 py-2.5 font-semibold">{t("invoicePlan")}</th>
            <th className="px-4 py-2.5 font-semibold">{t("invoicePeriod")}</th>
            <th className="px-4 py-2.5 text-right font-semibold">
              {t("invoiceAmount")}
            </th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className="border-t border-[var(--color-border)]">
              <td className="px-4 py-2.5 text-[var(--color-foreground)]">
                {fmtDate(p.paidAt ?? p.createdAt)}
              </td>
              <td className="px-4 py-2.5 text-[var(--color-foreground)]">
                {planName(p.planKey)}
              </td>
              <td className="px-4 py-2.5 text-[var(--color-muted-foreground)]">
                {p.period === "annual" ? t("annual") : t("monthly")}
              </td>
              <td className="px-4 py-2.5 text-right font-medium text-[var(--color-foreground)]">
                {Math.round(p.amount)} {p.currency === "ILS" ? "₪" : "€"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Bits ────────────────────────────────────────────────────────────────────

function SectionTitle({ title }: { title: string }) {
  return (
    <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--color-foreground)]">
      {title}
    </h2>
  );
}

// ─── Payment modal (HYP iframe) ──────────────────────────────────────────────

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
