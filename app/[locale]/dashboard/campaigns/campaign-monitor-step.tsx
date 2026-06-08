"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export type LiveSnapshot = {
  status: string;
  counts: {
    total: number;
    queued: number;
    inFlight: number;
    done: number;
    connected: number;
  };
  pickupRate: number;
  outcomes: Record<string, number>;
  dispositions: Record<string, number>;
  recent: Array<{
    id: string;
    phoneNumber: string;
    outcome: string;
    disposition: string;
    sentiment: string;
    summary: string;
    durationSeconds: number;
    createdAt: string;
  }>;
};

const SENT_TONE: Record<string, string> = {
  positive: "bg-[#dcfce7] text-[#166534]",
  neutral: "bg-[#f1f5f9] text-[#475569]",
  negative: "bg-[#fee2e2] text-[#b91c1c]",
};

function LiveTile({
  label,
  value,
  tone,
  pulse,
}: {
  label: string;
  value: string | number;
  tone: string;
  pulse?: boolean;
}) {
  return (
    <div className="relative rounded-2xl border border-[#e2e8f0] bg-white p-4 text-center">
      {pulse && Number(value) > 0 && (
        <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-[#16a34a] motion-safe:animate-ping" />
      )}
      <p className={`text-2xl font-extrabold ${tone}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">
        {label}
      </p>
    </div>
  );
}

// Poll /live tant que la campagne tourne ; affiche tuiles + feed des appels.
export function CampaignMonitor({
  campaignId,
  asUserId,
  status,
}: {
  campaignId: string;
  asUserId?: string;
  status: string;
}) {
  const t = useTranslations("DashboardCampaigns");
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
    const tick = () => {
      fetch(`/api/dashboard/campaigns/${campaignId}/live${qs}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("live"))))
        .then((data: LiveSnapshot) => {
          if (cancelled) return;
          setSnap(data);
          // Re-poll seulement si la campagne tourne encore.
          if (data.status === "running")
            timer.current = setTimeout(tick, 2500);
        })
        .catch(() => {
          if (!cancelled) timer.current = setTimeout(tick, 5000);
        });
    };
    tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [campaignId, asUserId, status]);

  if (!snap) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <LiveTile
          label={t("monitorInFlight")}
          value={snap.counts.inFlight}
          tone="text-[#ea580c]"
          pulse
        />
        <LiveTile
          label={t("monitorPickup")}
          value={`${snap.pickupRate}%`}
          tone="text-[#16a34a]"
        />
        <LiveTile
          label={t("detailQueued")}
          value={snap.counts.queued}
          tone="text-[#64748b]"
        />
        <LiveTile
          label={t("detailConnected")}
          value={snap.counts.connected}
          tone="text-[#3730a3]"
        />
      </div>

      {/* Feed des appels récents */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4">
        <p className="mb-2 text-[13px] font-bold text-[#18181b]">
          {t("monitorRecent")}
        </p>
        {snap.recent.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-[#94a3b8]">
            {t("monitorWaiting")}
          </p>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto">
            <AnimatePresence initial={false}>
              {snap.recent.map((c) => (
                <motion.div
                  key={c.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-3 rounded-xl border border-[#f1f5f9] bg-[#f8fafc] px-3 py-2"
                >
                  <span className="mt-0.5 font-mono text-[12px] text-[#334155]">
                    {c.phoneNumber}
                  </span>
                  <div className="min-w-0 flex-1">
                    {c.summary && (
                      <p className="truncate text-[12px] text-[#475569]">
                        {c.summary}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-[#e0e7ff] px-2 py-0.5 text-[10px] font-bold text-[#3730a3]">
                        {t(`outcome_${c.outcome}`)}
                      </span>
                      {c.disposition && (
                        <span className="rounded-full bg-[#fff7ed] px-2 py-0.5 text-[10px] font-bold text-[#9a3412]">
                          {t(`disposition_${c.disposition}`)}
                        </span>
                      )}
                      {c.sentiment && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SENT_TONE[c.sentiment] ?? SENT_TONE.neutral}`}
                        >
                          {t(`sentiment_${c.sentiment}`)}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
