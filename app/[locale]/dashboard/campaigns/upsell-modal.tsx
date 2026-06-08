"use client";

/**
 * Modal d'upsell affiché quand un tenant non-premium (et non-admin) clique sur
 * la tuile "Centre d'appels sortant". Met en avant le plan premium ("Centre
 * d'appels pro") + CTA vers /dashboard/billing. Même chrome que les autres
 * modals du dashboard (backdrop blur + spring), accent chaud orange→rose.
 */

import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { planByKey } from "@/lib/plans";

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#f97316] to-[#db2777] text-white">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <span className="text-[13px] leading-snug text-[#334155]">{children}</span>
    </li>
  );
}

export function UpsellModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("DashboardCampaigns");
  const locale = useLocale();
  const premium = planByKey("premium");

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <motion.div
            className="absolute inset-0 bg-[#0f172a]/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="relative z-10 flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
          >
            {/* Header dégradé chaud */}
            <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-[#f97316] via-[#ef4444] to-[#db2777] px-6 py-6 text-white">
              <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/15 blur-2xl" />
              <div className="absolute -left-8 bottom-0 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
              <div className="relative flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/80">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    {t("upsellKicker")}
                  </div>
                  <h3 className="mt-1.5 text-xl font-extrabold tracking-tight">
                    {t("upsellTitle")}
                  </h3>
                  <p className="mt-1 text-[13px] text-white/85">
                    {t("upsellSubtitle", { plan: premium.name })}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-full p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white"
                  aria-label={t("close")}
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <ul className="space-y-2.5">
                <Bullet>{t("upsellBullet1")}</Bullet>
                <Bullet>{t("upsellBullet2")}</Bullet>
                <Bullet>{t("upsellBullet3")}</Bullet>
                <Bullet>{t("upsellBullet4")}</Bullet>
              </ul>

              <div className="mt-5 flex items-end justify-between rounded-2xl border border-[#fed7aa] bg-gradient-to-br from-[#fff7ed] to-[#fdf2f8] px-4 py-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9a3412]">
                    {premium.name}
                  </p>
                  <p className="mt-0.5 text-[12px] text-[#7c2d12]/80">
                    {premium.tagline}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-2xl font-extrabold text-[#9a3412]">
                    {premium.monthly}€
                  </span>
                  <span className="text-[12px] font-medium text-[#9a3412]/70">
                    {t("upsellPriceSuffix")}
                  </span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#e2e8f0] bg-[#f8fafc] px-6 py-3.5">
              <button
                onClick={onClose}
                className="text-[13px] font-semibold text-[#64748b] transition hover:text-[#334155]"
              >
                {t("upsellLater")}
              </button>
              <Link
                href={`/${locale}/dashboard/billing`}
                className="rounded-xl bg-gradient-to-br from-[#f97316] to-[#db2777] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90"
              >
                {t("upsellCta", { plan: premium.name })}
              </Link>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
