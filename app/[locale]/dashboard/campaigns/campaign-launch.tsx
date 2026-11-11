"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { launchHeading, TONE_CHIP, type DispatchMode } from "@/lib/campaigns/live-view";
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
  dispatchMode,
  onChanged,
  onDispatchMode,
}: {
  campaignId: string;
  asUserId?: string;
  status: string;
  stats?: CampaignStats;
  /** Platform call switch as last seen (live console snapshot or a start's answer); null = not known yet. */
  dispatchMode?: DispatchMode | null;
  onChanged: (status: string) => void;
  /** A start / resume answers with the call switch: hand it up so the heading follows. */
  onDispatchMode?: (mode: DispatchMode) => void;
}) {
  const t = useTranslations("DashboardCampaigns");
  const [busy, setBusy] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Compteurs frais récupérés directement (GET [id]) — la prop `stats` venant
  // de la liste parente peut être périmée/absente, ce qui désactivait à tort
  // le bouton de lancement. Re-fetch à chaque changement de statut.
  const [counts, setCounts] = useState<Counts | null>(null);
  // Vrai si la campagne n'a NI objectif NI base de connaissance → l'agent
  // n'aurait rien de concret à vendre (risque d'invention). On avertit.
  const [lacksContent, setLacksContent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
    fetch(`/api/dashboard/campaigns/${campaignId}${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then(
        (data: {
          counts?: Counts;
          campaign?: { objective?: string };
          agent?: { knowledge?: string } | null;
        }) => {
          if (cancelled) return;
          if (data.counts) setCounts(data.counts);
          const obj = (data.campaign?.objective ?? "").trim();
          // La connaissance métier vit désormais sur l'agent associé.
          const kn = (data.agent?.knowledge ?? "").trim();
          setLacksContent(!obj && !kn);
        },
      )
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
        const data = (await res.json()) as { campaign: { status: string }; dispatchMode?: DispatchMode };
        if (data.dispatchMode) onDispatchMode?.(data.dispatchMode);
        onChanged(data.campaign.status);
      }
    } catch {
      /* noop */
    } finally {
      setBusy(false);
    }
  };

  const testCall = async () => {
    if (testBusy) return;
    const phone = testPhone.trim();
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
      setTestMsg({ ok: false, text: t("testCallInvalid") });
      return;
    }
    setTestBusy(true);
    setTestMsg(null);
    try {
      const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
      const res = await fetch(
        `/api/dashboard/campaigns/${campaignId}/test-call${qs}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phoneNumber: phone }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) setTestMsg({ ok: true, text: t("testCallSent") });
      else if (data.error === "no_caller_id")
        setTestMsg({ ok: false, text: t("testCallNoCallerId") });
      else setTestMsg({ ok: false, text: t("testCallError") });
    } catch {
      setTestMsg({ ok: false, text: t("testCallError") });
    } finally {
      setTestBusy(false);
    }
  };

  // Une campagne terminée/archivée peut être relancée (re-met en file les
  // contacts non aboutis côté serveur via l'action "start").
  const stopped = status === "completed" || status === "archived";
  const showStart = status === "draft" || status === "paused" || stopped;
  const heading = launchHeading(dispatchMode);

  return (
    <div className="space-y-5">
      {lacksContent && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[12px] text-[#92400e]">
          <span className="mt-0.5 text-base leading-none">⚠️</span>
          <span>{t("launchNoContentWarning")}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountTile label={t("detailQueued")} value={eff.queued} tone="text-[#64748b]" />
        <CountTile label={t("detailInFlight")} value={eff.inFlight} tone="text-[#ea580c]" />
        <CountTile label={t("detailDone")} value={eff.done} tone="text-[#3730a3]" />
        <CountTile label={t("detailConnected")} value={eff.connected} tone="text-[#16a34a]" />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#fed7aa] bg-gradient-to-br from-[#fff7ed] to-[#fdf2f8] px-5 py-4">
        <div className="flex-1">
          {/* Same source as the console's pill: "ready" only when calls really go out. */}
          {heading.tone === "warn" ? (
            <p
              role="status"
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-bold ring-1 ${TONE_CHIP.warn}`}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 shrink-0" aria-hidden>
                <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
              </svg>
              {t(heading.key)}
            </p>
          ) : (
            <p className="text-[14px] font-bold text-[#9a3412]">
              {t(heading.key)}
            </p>
          )}
          {!canStart && (
            <p className="text-[12px] text-[#9a3412]/70">{t("noContactsYet")}</p>
          )}
        </div>

        {showStart && (
          <button
            onClick={() => act("start")}
            disabled={busy || !canStart}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#c2410c] to-[#db2777] px-5 py-2.5 text-[13px] font-bold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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

      {/* Appel test immédiat — bypasse la fenêtre horaire et la file. */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white px-5 py-4">
        <p className="text-[13px] font-bold text-[#334155]">{t("testCallTitle")}</p>
        <p className="mt-0.5 text-[12px] text-[#94a3b8]">{t("testCallHint")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="tel"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="+9725xxxxxxxx"
            className="min-w-[180px] flex-1 rounded-xl border border-[#e2e8f0] px-3 py-2 text-[13px] focus:border-[#db2777] focus:outline-none focus:ring-2 focus:ring-[#db2777]/20"
          />
          <button
            onClick={testCall}
            disabled={testBusy || !testPhone.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#0e7490] px-4 py-2 text-[13px] font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
              <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24 11.36 11.36 0 0 0 3.57.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.24 1.02l-2.2 2.2z" />
            </svg>
            {testBusy ? t("testCallSending") : t("testCallCta")}
          </button>
        </div>
        {testMsg && (
          <p
            className={`mt-2 text-[12px] font-medium ${
              testMsg.ok ? "text-[#16a34a]" : "text-[#dc2626]"
            }`}
          >
            {testMsg.text}
          </p>
        )}
      </div>
    </div>
  );
}
