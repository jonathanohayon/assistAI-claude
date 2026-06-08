"use client";

import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { currencyForLocale } from "@/lib/hyp";
import { currencySymbol, resolvePrice, type PlanPricingMap } from "@/lib/plan-pricing";
import { type Plan, type PlanKey } from "@/lib/plans";

type Period = "monthly" | "annual";

/**
 * Gate bloquant affiché par le layout dashboard quand l'essai gratuit est
 * terminé et que le compte n'est pas payé (subscription "expired"). Force le
 * choix d'une formule puis la saisie CB via l'iframe de paiement HYP — c'est
 * le même flux que la page billing (POST /api/dashboard/hyp/create-payment).
 */
export function TrialExpiredGate({
  plans,
  pricing,
  logoutAction,
}: {
  plans: Plan[];
  pricing: PlanPricingMap;
  logoutAction: () => Promise<void>;
}) {
  const t = useTranslations("DashboardBilling");
  const tPlans = useTranslations("Plans");
  const locale = useLocale();
  const currency = currencyForLocale(locale);

  const [period, setPeriod] = useState<Period>("monthly");
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<PlanKey | null>(null);
  const [error, setError] = useState(false);

  const planName = (p: Plan) => {
    try {
      return tPlans(`${p.key}.name`);
    } catch {
      return p.name;
    }
  };

  const startPayment = async (plan: PlanKey) => {
    if (loadingPlan) return;
    setLoadingPlan(plan);
    setError(false);
    setPayUrl(null);
    try {
      const res = await fetch("/api/dashboard/hyp/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, period, locale }),
      });
      const data = (await res.json()) as { url?: string };
      if (data.url) setPayUrl(data.url);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setLoadingPlan(null);
    }
  };

  const sym = currencySymbol(currency);

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[#1e2937]/70 p-4 backdrop-blur-md sm:items-center">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="my-auto w-full max-w-2xl rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-2xl sm:p-8"
      >
        {payUrl ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setPayUrl(null)}
              className="text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              ← {t("gateBack")}
            </button>
            <iframe
              key={payUrl}
              src={payUrl}
              title="Paiement HYP"
              allow="payment"
              className="h-[560px] w-full rounded-2xl border border-[var(--color-border)]"
            />
          </div>
        ) : (
          <>
            <div className="text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                {t("statusExpired")}
              </span>
              <h2 className="mt-3 font-display text-2xl tracking-tight text-[var(--color-foreground)]">
                {t("gateHeading")}
              </h2>
              <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                {t("gateSubtitle")}
              </p>
            </div>

            {/* Toggle mensuel / annuel */}
            <div className="mt-5 flex justify-center">
              <div className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-muted)] p-1">
                {(["monthly", "annual"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setPeriod(opt)}
                    className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                      period === opt
                        ? "bg-white text-[var(--color-foreground)] shadow-sm"
                        : "text-[var(--color-muted-foreground)]"
                    }`}
                  >
                    {opt === "monthly" ? t("monthly") : t("annual")}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {plans.map((p) => {
                const price = resolvePrice(pricing, p.key, period, currency);
                return (
                  <div
                    key={p.key}
                    className="flex flex-col rounded-2xl border border-[var(--color-border)] bg-white p-4 transition-shadow hover:shadow-md"
                  >
                    <p className="font-display text-lg text-[var(--color-foreground)]">
                      {planName(p)}
                    </p>
                    <p className="mt-1">
                      <span className="font-display text-2xl font-bold tabular-nums text-[var(--color-foreground)]">
                        {price} {sym}
                      </span>
                      <span className="text-xs text-[var(--color-muted-foreground)]">
                        {" "}
                        {t("gatePerMonth")}
                      </span>
                    </p>
                    <button
                      type="button"
                      onClick={() => startPayment(p.key)}
                      disabled={loadingPlan != null}
                      className="mt-4 inline-flex items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white shadow-md transition-transform hover:scale-[1.02] disabled:opacity-60"
                    >
                      {loadingPlan === p.key ? t("processing") : t("gateSelect")}
                    </button>
                  </div>
                );
              })}
            </div>

            {error && (
              <p className="mt-3 text-center text-xs text-red-600">
                {t("paymentFailed")}
              </p>
            )}

            <form action={logoutAction} className="mt-5 text-center">
              <button
                type="submit"
                className="text-xs text-[var(--color-muted-foreground)] underline-offset-2 hover:underline"
              >
                {t("gateLogout")}
              </button>
            </form>
          </>
        )}
      </motion.div>
    </div>
  );
}
