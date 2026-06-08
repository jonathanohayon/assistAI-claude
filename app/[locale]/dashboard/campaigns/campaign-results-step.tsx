"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import {
  CountUpStat,
  ConversionFunnel,
  DispositionDonut,
  SentimentBand,
} from "./charts";

type Results = {
  totalContacts: number;
  funnel: {
    dialed: number;
    connected: number;
    engaged: number;
    qualified: number;
    converted: number;
  };
  kpis: {
    calls: number;
    connected: number;
    qualified: number;
    avgDurationSeconds: number;
    costCents: number;
  };
  sentiment: { positive: number; neutral: number; negative: number };
  dispositions: Record<string, number>;
  outcomes: Record<string, number>;
};

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4">
      <p className="mb-3 text-[13px] font-bold text-[#18181b]">{title}</p>
      {children}
    </div>
  );
}

// Dashboard analytics animé — n'apparaît que quand des appels ont eu lieu.
export function CampaignResults({
  campaignId,
  asUserId,
}: {
  campaignId: string;
  asUserId?: string;
}) {
  const t = useTranslations("DashboardCampaigns");
  const [data, setData] = useState<Results | null>(null);

  useEffect(() => {
    let cancelled = false;
    const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
    fetch(`/api/dashboard/campaigns/${campaignId}/results${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("results"))))
      .then((d: Results) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        /* noop */
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, asUserId]);

  // Rien à montrer tant qu'aucun appel n'a été passé.
  if (!data || data.funnel.dialed === 0) return null;

  const avgMin = Math.floor(data.kpis.avgDurationSeconds / 60);
  const avgSec = data.kpis.avgDurationSeconds % 60;
  const avgLabel =
    data.kpis.avgDurationSeconds > 0
      ? `${avgMin}:${avgSec.toString().padStart(2, "0")}`
      : "—";

  return (
    <div className="space-y-4">
      <p className="text-[15px] font-extrabold text-[#18181b]">
        {t("resultsTitle")}
      </p>

      {/* KPIs count-up */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountUpStat value={data.kpis.calls} label={t("kpiCalls")} accent="text-[#ea580c]" />
        <CountUpStat value={data.kpis.connected} label={t("kpiConnected")} accent="text-[#16a34a]" />
        <CountUpStat value={data.kpis.qualified} label={t("kpiQualified")} accent="text-[#6366f1]" />
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4 text-center">
          <p className="text-3xl font-extrabold tracking-tight text-[#db2777]">
            {avgLabel}
          </p>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">
            {t("kpiAvgDuration")}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("resultsFunnel")}>
          <ConversionFunnel
            stages={[
              { label: t("funnelDialed"), value: data.funnel.dialed },
              { label: t("funnelConnected"), value: data.funnel.connected },
              { label: t("funnelEngaged"), value: data.funnel.engaged },
              { label: t("funnelQualified"), value: data.funnel.qualified },
              { label: t("funnelConverted"), value: data.funnel.converted },
            ]}
          />
        </Card>

        <Card title={t("resultsDispositions")}>
          <DispositionDonut
            slices={Object.entries(data.dispositions).map(([k, v]) => ({
              label: t(`disposition_${k}`),
              value: v,
            }))}
          />
        </Card>
      </div>

      <Card title={t("resultsSentiment")}>
        <SentimentBand
          positive={data.sentiment.positive}
          neutral={data.sentiment.neutral}
          negative={data.sentiment.negative}
          labels={{
            positive: t("sentiment_positive"),
            neutral: t("sentiment_neutral"),
            negative: t("sentiment_negative"),
          }}
        />
      </Card>
    </div>
  );
}
