"use client";

/**
 * Modal Analytics d'une campagne sortante : KPIs, graphes animés (issues,
 * sentiment, appels/jour, taux de succès) et liste des discussions avec
 * transcription + verdict critères de succès par appel.
 */

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Call = {
  id: string;
  phoneNumber: string;
  outcome: string;
  durationSeconds: number;
  success: string | null;
  sentiment: string | null;
  summary: string;
  transcript: Array<{ role: "user" | "assistant"; text: string }>;
  createdAt: string;
};

interface Results {
  campaign: { id: string; name: string; objective: string; successCriteria: string };
  aggregates: {
    total: number;
    connected: number;
    success: number;
    partial: number;
    successRate: number;
    avgDurationSec: number;
    totalMinutes: number;
    byOutcome: Record<string, number>;
    bySentiment: Record<string, number>;
    perDay: { date: string; count: number }[];
    analyzedNow: number;
    pendingAnalysis: number;
  };
  calls: Call[];
}

const OUTCOME_COLORS: Record<string, string> = {
  connected: "#16a34a",
  no_answer: "#f59e0b",
  voicemail: "#6366f1",
  busy: "#a855f7",
  failed: "#ef4444",
};
const SENTIMENT_COLORS: Record<string, string> = {
  positive: "#16a34a",
  neutral: "#94a3b8",
  negative: "#ef4444",
};
const SUCCESS_COLORS: Record<string, string> = {
  success: "#16a34a",
  partial: "#f59e0b",
  fail: "#ef4444",
};

const fmtDuration = (s: number) =>
  s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "—";

export function CampaignAnalytics({
  campaignId,
  campaignName,
  asUserId,
  onClose,
}: {
  campaignId: string;
  campaignName: string;
  asUserId?: string;
  onClose: () => void;
}) {
  const t = useTranslations("DashboardCampaigns");
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const [data, setData] = useState<Results | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [openCall, setOpenCall] = useState<string | null>(null);

  const load = useCallback(async () => {
    const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
    try {
      const res = await fetch(
        `/api/dashboard/campaigns/${campaignId}/results${qs}`,
      );
      if (!res.ok) throw new Error("load");
      setData((await res.json()) as Results);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [campaignId, asUserId]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const outcomeLabel = useCallback(
    (o: string) => t(`outcome_${o}` as "outcome_connected"),
    [t],
  );

  const outcomeData = useMemo(
    () =>
      data
        ? Object.entries(data.aggregates.byOutcome).map(([k, v]) => ({
            key: k,
            name: outcomeLabel(k),
            value: v,
          }))
        : [],
    [data, outcomeLabel],
  );
  const sentimentData = useMemo(
    () =>
      data
        ? Object.entries(data.aggregates.bySentiment).map(([k, v]) => ({
            key: k,
            name: t(`sentiment_${k}` as "sentiment_positive"),
            value: v,
          }))
        : [],
    [data, t],
  );

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
        <motion.div
          className="absolute inset-0 bg-[#0f172a]/55 backdrop-blur-sm"
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
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="relative z-10 flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl bg-[#f8fafc] shadow-2xl sm:h-[88vh] sm:rounded-3xl"
        >
          {/* Header */}
          <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-[#6366f1] via-[#7c3aed] to-[#db2777] px-6 py-4 text-white">
            <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/15 blur-2xl" />
            <div className="relative flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/75">
                  <span>📊</span>
                  {t("analyticsKicker")}
                </div>
                <h3 className="truncate text-lg font-extrabold tracking-tight">
                  {campaignName}
                </h3>
              </div>
              <button
                onClick={onClose}
                aria-label={t("close")}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-[#64748b]">
                <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#e2e8f0] border-t-[#7c3aed]" />
                {t("analyticsLoading")}
              </div>
            ) : error || !data ? (
              <div className="flex h-full items-center justify-center text-sm text-[#dc2626]">
                {t("analyticsError")}
              </div>
            ) : data.aggregates.total === 0 ? (
              <div className="flex h-full items-center justify-center text-center text-sm text-[#64748b]">
                {t("analyticsEmpty")}
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                {data.aggregates.pendingAnalysis > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-800">
                    {t("analyticsPending", { count: data.aggregates.pendingAnalysis })}
                  </div>
                )}

                {/* KPIs */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Kpi label={t("kpiTotal")} value={String(data.aggregates.total)} />
                  <Kpi label={t("kpiConnected")} value={String(data.aggregates.connected)} tone="text-[#16a34a]" />
                  <Kpi label={t("kpiSuccessRate")} value={`${data.aggregates.successRate}%`} tone="text-[#7c3aed]" />
                  <Kpi label={t("kpiAvgDuration")} value={fmtDuration(data.aggregates.avgDurationSec)} />
                </div>

                {/* Graphes */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <ChartCard title={t("chartSuccess")}>
                    <ResponsiveContainer width="100%" height={200}>
                      <RadialBarChart
                        innerRadius="70%"
                        outerRadius="100%"
                        data={[{ name: "s", value: data.aggregates.successRate, fill: "#7c3aed" }]}
                        startAngle={90}
                        endAngle={-270}
                      >
                        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                        <RadialBar dataKey="value" cornerRadius={12} background />
                      </RadialBarChart>
                    </ResponsiveContainer>
                    <p className="-mt-[120px] text-center text-3xl font-extrabold text-[#7c3aed]">
                      {data.aggregates.successRate}%
                    </p>
                    <p className="mt-[88px] text-center text-[11px] text-[#94a3b8]">
                      {t("successOnConnected", { n: data.aggregates.success, total: data.aggregates.connected })}
                    </p>
                  </ChartCard>

                  <ChartCard title={t("chartOutcomes")}>
                    <DonutChart data={outcomeData} colorFor={(k) => OUTCOME_COLORS[k] ?? "#94a3b8"} emptyLabel={t("chartEmpty")} />
                  </ChartCard>

                  <ChartCard title={t("chartSentiment")}>
                    <DonutChart data={sentimentData} colorFor={(k) => SENTIMENT_COLORS[k] ?? "#94a3b8"} emptyLabel={t("chartEmpty")} />
                  </ChartCard>
                </div>

                <ChartCard title={t("chartPerDay")}>
                  {data.aggregates.perDay.length === 0 ? (
                    <p className="py-8 text-center text-[12px] text-[#94a3b8]">{t("chartEmpty")}</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={data.aggregates.perDay}>
                        <XAxis
                          dataKey="date"
                          tickFormatter={(d: string) => d.slice(5).replace("-", "/")}
                          tick={{ fill: "#94a3b8", fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} width={28} />
                        <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
                        <Bar dataKey="count" fill="#7c3aed" radius={[6, 6, 0, 0]} maxBarSize={40} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </ChartCard>

                {/* Conversations */}
                <div>
                  <h4 className="mb-2 text-[13px] font-bold text-[#18181b]">
                    {t("conversationsTitle", { count: data.calls.length })}
                  </h4>
                  <div className="flex flex-col gap-2">
                    {data.calls.map((c) => (
                      <ConversationRow
                        key={c.id}
                        call={c}
                        open={openCall === c.id}
                        onToggle={() => setOpenCall(openCall === c.id ? null : c.id)}
                        outcomeLabel={outcomeLabel}
                        t={t}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-[#e2e8f0] bg-white p-4 text-center"
    >
      <p className={`text-2xl font-extrabold ${tone ?? "text-[#18181b]"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">
        {label}
      </p>
    </motion.div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white p-4"
    >
      <p className="mb-2 text-[12px] font-bold text-[#334155]">{title}</p>
      {children}
    </motion.div>
  );
}

function DonutChart({
  data,
  colorFor,
  emptyLabel,
}: {
  data: { key: string; name: string; value: number }[];
  colorFor: (k: string) => string;
  emptyLabel: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0)
    return <p className="py-8 text-center text-[12px] text-[#94a3b8]">{emptyLabel}</p>;
  return (
    <div>
      <ResponsiveContainer width="100%" height={150}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={2}>
            {data.map((d) => (
              <Cell key={d.key} fill={colorFor(d.key)} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1">
        {data.map((d) => (
          <span key={d.key} className="inline-flex items-center gap-1 text-[11px] text-[#64748b]">
            <span className="h-2 w-2 rounded-full" style={{ background: colorFor(d.key) }} />
            {d.name} ({d.value})
          </span>
        ))}
      </div>
    </div>
  );
}

function ConversationRow({
  call,
  open,
  onToggle,
  outcomeLabel,
  t,
}: {
  call: Call;
  open: boolean;
  onToggle: () => void;
  outcomeLabel: (o: string) => string;
  t: ReturnType<typeof useTranslations<"DashboardCampaigns">>;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition hover:bg-[#f8fafc]"
      >
        <span dir="ltr" className="font-mono text-[12px] text-[#18181b]">{call.phoneNumber}</span>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
          style={{ background: OUTCOME_COLORS[call.outcome] ?? "#94a3b8" }}
        >
          {outcomeLabel(call.outcome)}
        </span>
        {call.success && (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
            style={{ background: SUCCESS_COLORS[call.success] ?? "#94a3b8" }}
          >
            {t(`success_${call.success}` as "success_success")}
          </span>
        )}
        {call.sentiment && (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{
              background: `${SENTIMENT_COLORS[call.sentiment]}1a`,
              color: SENTIMENT_COLORS[call.sentiment],
            }}
          >
            {t(`sentiment_${call.sentiment}` as "sentiment_positive")}
          </span>
        )}
        <span className="ml-auto text-[11px] text-[#94a3b8]">
          {fmtDuration(call.durationSeconds)}
        </span>
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 shrink-0 text-[#94a3b8] transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-[#f1f5f9]"
          >
            <div className="px-3.5 py-3">
              {call.summary && (
                <p className="mb-2 rounded-lg bg-[#f8fafc] px-3 py-2 text-[12px] text-[#475569]">
                  {call.summary}
                </p>
              )}
              {call.transcript.length === 0 ? (
                <p className="text-[12px] italic text-[#94a3b8]">{t("noTranscript")}</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {call.transcript.map((m, i) => (
                    <div
                      key={i}
                      className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-[12px] ${
                        m.role === "assistant"
                          ? "self-start bg-[#ede9fe] text-[#5b21b6]"
                          : "self-end bg-[#e2e8f0] text-[#18181b]"
                      }`}
                    >
                      {m.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
