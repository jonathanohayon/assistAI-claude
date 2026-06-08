"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import type { CampaignStats } from "@/lib/campaigns/types";

export function CampaignLaunch({
  campaignId,
  asUserId,
  status,
  stats,
  onChanged,
}: {
  campaignId: string;
  asUserId?: string;
  status: string;
  stats?: CampaignStats;
  onChanged: (status: string) => void;
}) {
  const t = useTranslations("DashboardCampaigns");
  const [busy, setBusy] = useState(false);

  const total = stats?.total ?? 0;
  const canStart = total > 0;

  const act = async (action: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
      const res = await fetch(
        `/api/dashboard/campaigns/${campaignId}/status${qs}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      if (res.ok) {
        const data = (await res.json()) as { campaign: { status: string } };
        onChanged(data.campaign.status);
      }
    } catch {
      /* noop */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#fed7aa] bg-gradient-to-br from-[#fff7ed] to-[#fdf2f8] px-5 py-4">
        <div className="flex-1">
          <p className="text-[14px] font-bold text-[#9a3412]">
            {t("launchTitle")}
          </p>
          {!canStart && (
            <p className="text-[12px] text-[#9a3412]/70">{t("noContactsYet")}</p>
          )}
        </div>

        {(status === "draft" || status === "paused") && (
          <button
            onClick={() => act("start")}
            disabled={busy || !canStart}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f97316] to-[#db2777] px-5 py-2.5 text-[13px] font-bold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
              <path d="M8 5v14l11-7z" />
            </svg>
            {status === "paused" ? t("resumeCta") : t("startCta")}
          </button>
        )}
        {status === "running" && (
          <button
            onClick={() => act("pause")}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-[#fdba74] bg-white px-5 py-2.5 text-[13px] font-bold text-[#ea580c] transition hover:bg-[#fff7ed] disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
              <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
            </svg>
            {t("pauseCta")}
          </button>
        )}
        {(status === "running" || status === "paused") && (
          <button
            onClick={() => act("complete")}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-[13px] font-bold text-[#64748b] transition hover:bg-[#f8fafc] disabled:opacity-50"
          >
            {t("completeCta")}
          </button>
        )}
      </div>
    </div>
  );
}
