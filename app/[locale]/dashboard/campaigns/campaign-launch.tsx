"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import type { CampaignStats } from "@/lib/campaigns/types";

function CountTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4 text-center">
      <p className={`text-2xl font-extrabold ${tone}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">
        {label}
      </p>
    </div>
  );
}

type Counts = {
  total: number;
  queued: number;
  inFlight: number;
  done: number;
  connected: number;
};

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
  // Compteurs frais récupérés directement (GET [id]) — la prop `stats` venant
  // de la liste parente peut être périmée/absente, ce qui désactivait à tort
  // le bouton de lancement. Re-fetch à chaque changement de statut.
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    let cancelled = false;
    const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
    fetch(`/api/dashboard/campaigns/${campaignId}${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((data: { counts?: Counts }) => {
        if (!cancelled && data.counts) setCounts(data.counts);
      })
      .catch(() => {
        /* on garde la prop stats en fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, asUserId, status]);

  // Compteurs effectifs : frais si dispo, sinon la prop parente.
  const eff: Counts = counts ?? {
    total: stats?.total ?? 0,
    queued: stats?.queued ?? 0,
    inFlight: stats?.inFlight ?? 0,
    done: stats?.done ?? 0,
    connected: stats?.connected ?? 0,
  };
  const canStart = eff.total > 0;

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

  // Une campagne terminée/archivée peut être relancée (re-met en file les
  // contacts non aboutis côté serveur via l'action "start").
  const stopped = status === "completed" || status === "archived";
  const showStart = status === "draft" || status === "paused" || stopped;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountTile label={t("detailQueued")} value={eff.queued} tone="text-[#64748b]" />
        <CountTile label={t("detailInFlight")} value={eff.inFlight} tone="text-[#ea580c]" />
        <CountTile label={t("detailDone")} value={eff.done} tone="text-[#3730a3]" />
        <CountTile label={t("detailConnected")} value={eff.connected} tone="text-[#16a34a]" />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#fed7aa] bg-gradient-to-br from-[#fff7ed] to-[#fdf2f8] px-5 py-4">
        <div className="flex-1">
          <p className="text-[14px] font-bold text-[#9a3412]">
            {t("launchTitle")}
          </p>
          {!canStart && (
            <p className="text-[12px] text-[#9a3412]/70">{t("noContactsYet")}</p>
          )}
        </div>

        {showStart && (
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
