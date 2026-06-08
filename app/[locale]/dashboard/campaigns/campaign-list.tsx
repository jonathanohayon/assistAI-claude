"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";

import { GOAL_PRESETS } from "@/lib/campaigns/constants";
import type { CampaignListItem } from "@/lib/campaigns/types";

import { StatusPill } from "./_ui";

const GOAL_EMOJI: Record<string, string> = {
  cold: "❄️",
  sales: "💼",
  lead_gen: "🎯",
  marketing: "📣",
  custom: "✨",
};

export function CampaignList({
  campaigns,
  loading,
  error,
  onOpen,
  onCreate,
}: {
  campaigns: CampaignListItem[];
  loading: boolean;
  error: string | null;
  onOpen: (c: CampaignListItem) => void;
  onCreate: () => void;
}) {
  const t = useTranslations("DashboardCampaigns");

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-extrabold text-[#18181b]">
          {t("listTitle")}
        </h3>
        <button
          type="button"
          onClick={onCreate}
          className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f97316] to-[#db2777] px-4 py-2 text-[13px] font-bold text-white shadow-md transition hover:scale-[1.03] hover:shadow-lg active:scale-95"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25 transition-transform group-hover:rotate-90">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-3 w-3">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          {t("newCampaign")}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2.5 text-[13px] text-[#b91c1c]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-2xl border border-[#e2e8f0] bg-[#f8fafc]"
            />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#fed7aa] bg-gradient-to-br from-[#fff7ed] to-[#fdf2f8] px-6 py-12 text-center">
          <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f97316] to-[#db2777] text-white shadow-md">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
              <path d="M3 11l18-5v12L3 14v-3z" />
              <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
            </svg>
          </span>
          <p className="text-[15px] font-bold text-[#18181b]">
            {t("listEmptyTitle")}
          </p>
          <p className="mt-1 max-w-xs text-[13px] text-[#64748b]">
            {t("listEmptyBody")}
          </p>
          <button
            type="button"
            onClick={onCreate}
            className="mt-4 rounded-xl bg-gradient-to-br from-[#f97316] to-[#db2777] px-5 py-2.5 text-[13px] font-bold text-white shadow-sm transition hover:opacity-90"
          >
            {t("newCampaign")}
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {campaigns.map((c, i) => (
            <motion.button
              key={c.id}
              type="button"
              onClick={() => onOpen(c)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="group flex flex-col gap-3 rounded-2xl border border-[#e2e8f0] bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-[#f97316]/40 hover:shadow-lg"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#fff7ed] to-[#fdf2f8] text-lg">
                    {GOAL_EMOJI[c.goalPreset] ?? "✨"}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-bold text-[#18181b]">
                      {c.name}
                    </p>
                    <p className="text-[11px] text-[#94a3b8]">
                      {t(
                        `goal_${GOAL_PRESETS.includes(c.goalPreset) ? c.goalPreset : "custom"}`,
                      )}
                    </p>
                  </div>
                </div>
                <StatusPill status={c.status} label={t(`status_${c.status}`)} />
              </div>

              <div className="flex items-center gap-4 text-[11px] text-[#64748b]">
                <span className="inline-flex items-center gap-1">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5 text-[#94a3b8]">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                  </svg>
                  {t("contactsCount", { count: c.stats.total })}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />
                  {c.stats.connected} {t("connectedLabel")}
                </span>
              </div>

              {/* Mini barre de progression file → terminé */}
              {c.stats.total > 0 && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#f1f5f9]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#f97316] to-[#db2777] transition-all"
                    style={{
                      width: `${Math.round((c.stats.done / c.stats.total) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
