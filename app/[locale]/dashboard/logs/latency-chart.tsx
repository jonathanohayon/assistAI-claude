"use client";

/**
 * Scatter chart de latence par appel — onglet Monitoring du dashboard.
 *
 * - X : temps (du début de la période au "maintenant")
 * - Y : latence totale E2E en ms (ttfaMs.mean ou greetingMs si pas de turn)
 * - Chaque point = 1 conversation (color magenta=SIP / cyan=web)
 * - Hover → popup avec 9 valeurs (8 hops + total)
 * - Period selector : 1h / 24h / 7j / 30j
 * - Live : poll toutes les 10s
 *
 * Pas de lib externe — SVG manuel pour rester light et avoir le contrôle
 * total du rendu. ~250 lignes suffisent pour ce niveau de feature.
 */

import { useEffect, useMemo, useRef, useState } from "react";

type Origin = "sip" | "web";

interface LatencyPoint {
  id: string;
  timestamp: string;
  origin: Origin;
  totalE2eMs: number | null;
  yMetrics: {
    ttfa: number | null;
    p95: number | null;
    greeting: number | null;
  };
  latencies: {
    twilioToWorker: number | null;
    workerToLivekit: number | null;
    workerToWebConfig: number | null;
    workerToOpenai: number | null;
    greeting: number | null;
    transcription: number | null;
    endOfUtterance: number | null;
    firstAudio: number | null;
  };
}

interface ChartData {
  points: LatencyPoint[];
  serverTime: string;
  sinceMs: number;
  untilMs: number;
}

type Period = "1h" | "24h" | "7d" | "30d";

const PERIOD_LABELS: Record<Period, string> = {
  "1h": "1 heure",
  "24h": "24 heures",
  "7d": "7 jours",
  "30d": "30 jours",
};

/** Choix de la métrique Y du graph. */
type YMetric = "ttfa" | "p95" | "greeting";

const Y_METRIC_LABELS: Record<YMetric, { short: string; long: string }> = {
  ttfa: {
    short: "TTFA moyen",
    long:
      "Time-To-First-Audio — temps moyen entre la fin de phrase user et le 1er son de réponse (= latence perçue par l'utilisateur, moyennée sur tous les tours de l'appel).",
  },
  p95: {
    short: "TTFA p95",
    long:
      "Time-To-First-Audio p95 — pire latence parmi les tours de l'appel (95e percentile). Plus représentatif que la moyenne si on veut voir les outliers.",
  },
  greeting: {
    short: "Greeting init",
    long:
      "Temps total entre le début de session et le 1er son du greeting de l'agent. Inclut les phases de setup (connect, config, OpenAI WS).",
  },
};

const POLL_INTERVAL_MS = 10_000;

// Marges en pixels autour de la zone de plotting
const CHART = {
  width: 920,
  height: 320,
  padTop: 20,
  padBottom: 40,
  padLeft: 56,
  padRight: 20,
};

const COLOR_BY_ORIGIN: Record<Origin, { fill: string; stroke: string }> = {
  sip: { fill: "#ec4899", stroke: "#be185d" },
  web: { fill: "#22d3ee", stroke: "#0e7490" },
};

const HOP_LABELS: Array<{ key: keyof LatencyPoint["latencies"]; label: string }> =
  [
    { key: "twilioToWorker", label: "Twilio/Web → Worker" },
    { key: "workerToLivekit", label: "Worker → LiveKit (connect)" },
    { key: "workerToWebConfig", label: "Worker → Web (config)" },
    { key: "workerToOpenai", label: "Worker → OpenAI (WS)" },
    { key: "greeting", label: "Greeting (E2E init)" },
    { key: "transcription", label: "Transcription (STT)" },
    { key: "endOfUtterance", label: "End of utterance (LLM)" },
    { key: "firstAudio", label: "First audio (TTS)" },
  ];

export function LatencyChart() {
  const [period, setPeriod] = useState<Period>("24h");
  const [yMetric, setYMetric] = useState<YMetric>("ttfa");
  const [data, setData] = useState<ChartData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  // Helper : extrait la valeur Y selon la métrique sélectionnée.
  const getY = (p: LatencyPoint): number | null => {
    if (yMetric === "ttfa") return p.yMetrics.ttfa ?? p.yMetrics.greeting;
    if (yMetric === "p95") return p.yMetrics.p95 ?? p.yMetrics.ttfa;
    return p.yMetrics.greeting;
  };
  const [hover, setHover] = useState<{
    point: LatencyPoint;
    x: number;
    y: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Appel sélectionné = on affiche le panel détail à droite (drill-down).
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  // Timer pour différer la fermeture du tooltip (laisse le temps de cliquer
  // sur le bouton "Détails" sans que le tooltip disparaisse).
  const closeTooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTooltipClose = () => {
    if (closeTooltipTimer.current) {
      clearTimeout(closeTooltipTimer.current);
      closeTooltipTimer.current = null;
    }
  };
  const scheduleTooltipClose = () => {
    cancelTooltipClose();
    closeTooltipTimer.current = setTimeout(() => setHover(null), 180);
  };

  // Fetch data
  useEffect(() => {
    let aborted = false;
    const fetchData = async () => {
      try {
        const res = await fetch(
          `/api/dashboard/call-metrics?period=${period}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!aborted)
            setError(body?.error ?? `HTTP ${res.status}`);
          return;
        }
        const json = (await res.json()) as ChartData;
        if (!aborted) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (!aborted)
          setError(e instanceof Error ? e.message : "fetch error");
      }
    };
    void fetchData();
    if (paused) return () => {
      aborted = true;
    };
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => {
      aborted = true;
      clearInterval(id);
    };
  }, [period, paused]);

  // Compute scales
  const scales = useMemo(() => {
    if (!data) return null;
    const xMin = data.sinceMs;
    const xMax = data.untilMs;
    const validY = data.points
      .map(getY)
      .filter((v): v is number => v != null && v > 0);
    const yMax = validY.length > 0 ? Math.max(...validY) * 1.1 : 1000;
    const plotW = CHART.width - CHART.padLeft - CHART.padRight;
    const plotH = CHART.height - CHART.padTop - CHART.padBottom;
    const xTo = (t: number) =>
      CHART.padLeft + ((t - xMin) / Math.max(1, xMax - xMin)) * plotW;
    const yTo = (v: number) =>
      CHART.padTop + plotH - (v / Math.max(1, yMax)) * plotH;
    return { xMin, xMax, yMax, plotW, plotH, xTo, yTo };
  }, [data]);

  const plotPoints = useMemo(() => {
    if (!data || !scales) return [];
    return data.points
      .map((p) => ({ p, y: getY(p) }))
      .filter((entry): entry is { p: LatencyPoint; y: number } => entry.y != null)
      .map(({ p, y }) => ({
        ...p,
        yValue: y,
        cx: scales.xTo(new Date(p.timestamp).getTime()),
        cy: scales.yTo(y),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, scales, yMetric]);

  // X axis ticks (4 evenly spaced)
  const xTicks = useMemo(() => {
    if (!scales) return [] as Array<{ x: number; label: string }>;
    const ticks = 4;
    return Array.from({ length: ticks + 1 }, (_, i) => {
      const t = scales.xMin + ((scales.xMax - scales.xMin) * i) / ticks;
      return {
        x: scales.xTo(t),
        label: formatTickX(t, period),
      };
    });
  }, [scales, period]);

  const yTicks = useMemo(() => {
    if (!scales) return [] as Array<{ y: number; label: string }>;
    const ticks = 4;
    return Array.from({ length: ticks + 1 }, (_, i) => {
      const v = (scales.yMax * (ticks - i)) / ticks;
      return { y: scales.yTo(v), label: `${Math.round(v)} ms` };
    });
  }, [scales]);

  return (
    <section className="mb-8 rounded-3xl border border-[var(--color-border)] bg-white p-5 shadow-sm sm:p-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#be185d]">
            Monitoring · {Y_METRIC_LABELS[yMetric].short}
          </p>
          <h3 className="mt-1 font-display text-xl tracking-tight text-[#18181b] sm:text-2xl">
            Latence par appel (ms)
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[#475569]">
            {Y_METRIC_LABELS[yMetric].long}
          </p>
          <p className="mt-1 text-[11px] text-[#94a3b8]">
            {data && `${plotPoints.length} appel${plotPoints.length > 1 ? "s" : ""} sur la période · `}
            Live refresh {paused ? "(en pause)" : `toutes les ${POLL_INTERVAL_MS / 1000}s`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* Sélecteur de métrique Y */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#475569]">
              Métrique
            </span>
            {(Object.keys(Y_METRIC_LABELS) as YMetric[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setYMetric(m)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  yMetric === m
                    ? "bg-[#be185d] text-white shadow-sm"
                    : "bg-white text-[#475569] ring-1 ring-inset ring-[#e2e8f0] hover:bg-[#fdf2f8]"
                }`}
                title={Y_METRIC_LABELS[m].long}
              >
                {Y_METRIC_LABELS[m].short}
              </button>
            ))}
          </div>
          {/* Sélecteur de période */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#475569]">
              Période
            </span>
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  period === p
                    ? "bg-[#0e7490] text-white shadow-sm"
                    : "bg-white text-[#475569] ring-1 ring-inset ring-[#e2e8f0] hover:bg-[#ecfeff]"
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPaused((v) => !v)}
              className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#475569] ring-1 ring-inset ring-[#e2e8f0] hover:bg-[#fef3c7]"
              title="Pause / reprendre auto-refresh"
            >
              {paused ? "▶" : "⏸"}
            </button>
          </div>
        </div>
      </header>

      {error && (
        <p className="mb-3 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs text-[#991b1b]">
          {error}
        </p>
      )}

      {!data && !error && (
        <p className="py-12 text-center text-xs text-[#94a3b8]">Chargement…</p>
      )}

      {data && plotPoints.length === 0 && (
        <p className="py-12 text-center text-xs text-[#94a3b8]">
          Aucun appel sur cette période. Lance un test pour voir les données.
        </p>
      )}

      {data && plotPoints.length > 0 && scales && (
      <div
        className={`grid gap-4 ${
          selectedCallId
            ? "lg:grid-cols-[minmax(0,1fr)_360px]"
            : "grid-cols-1"
        }`}
      >
        <div ref={containerRef} className="relative overflow-x-auto">
          <svg
            viewBox={`0 0 ${CHART.width} ${CHART.height}`}
            width="100%"
            preserveAspectRatio="xMidYMid meet"
            className="block"
            role="img"
            aria-label="Graph latence par appel"
          >
            {/* Grid Y */}
            {yTicks.map((t, i) => (
              <line
                key={i}
                x1={CHART.padLeft}
                x2={CHART.width - CHART.padRight}
                y1={t.y}
                y2={t.y}
                stroke="#e2e8f0"
                strokeWidth={1}
                strokeDasharray={i === yTicks.length - 1 ? "0" : "4 4"}
              />
            ))}
            {/* Y labels */}
            {yTicks.map((t, i) => (
              <text
                key={i}
                x={CHART.padLeft - 8}
                y={t.y + 3}
                textAnchor="end"
                fontSize={10}
                fill="#94a3b8"
                fontFamily="ui-monospace, monospace"
              >
                {t.label}
              </text>
            ))}
            {/* X axis */}
            <line
              x1={CHART.padLeft}
              x2={CHART.width - CHART.padRight}
              y1={CHART.height - CHART.padBottom}
              y2={CHART.height - CHART.padBottom}
              stroke="#cbd5e1"
              strokeWidth={1}
            />
            {/* X labels */}
            {xTicks.map((t, i) => (
              <text
                key={i}
                x={t.x}
                y={CHART.height - CHART.padBottom + 16}
                textAnchor="middle"
                fontSize={10}
                fill="#94a3b8"
                fontFamily="ui-monospace, monospace"
              >
                {t.label}
              </text>
            ))}
            {/* Points */}
            {plotPoints.map((p) => {
              const c = COLOR_BY_ORIGIN[p.origin];
              const isHovered = hover?.point.id === p.id;
              return (
                <circle
                  key={p.id}
                  cx={p.cx}
                  cy={p.cy}
                  r={isHovered ? 7 : 5}
                  fill={c.fill}
                  stroke={c.stroke}
                  strokeWidth={isHovered ? 2 : 1.5}
                  opacity={isHovered ? 1 : 0.85}
                  style={{
                    cursor: "pointer",
                    transition: "r 120ms ease, opacity 120ms ease",
                  }}
                  onMouseEnter={(e) => {
                    cancelTooltipClose();
                    const rect = (
                      e.currentTarget.ownerSVGElement as SVGSVGElement
                    ).getBoundingClientRect();
                    const scale = rect.width / CHART.width;
                    setHover({
                      point: p,
                      x: p.cx * scale,
                      y: p.cy * scale,
                    });
                  }}
                  onMouseLeave={scheduleTooltipClose}
                  onClick={() => {
                    setSelectedCallId(p.id);
                    setHover(null);
                  }}
                />
              );
            })}
          </svg>
          {/* Tooltip (pointer-events:auto pour cliquer le bouton "Détails") */}
          {hover && (
            <div
              onMouseEnter={cancelTooltipClose}
              onMouseLeave={scheduleTooltipClose}
              className="absolute z-10 min-w-[280px] rounded-2xl border border-[#e2e8f0] bg-white p-3 shadow-lg"
              style={{
                left: Math.min(
                  hover.x + 12,
                  (containerRef.current?.clientWidth ?? 800) - 300,
                ),
                top: Math.max(hover.y - 8, 0),
              }}
            >
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#475569]">
                {new Date(hover.point.timestamp).toLocaleString("fr-FR", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                ·{" "}
                <span
                  style={{
                    color: COLOR_BY_ORIGIN[hover.point.origin].stroke,
                  }}
                >
                  {hover.point.origin === "sip" ? "SIP (tel)" : "Web LiveTest"}
                </span>
              </p>
              <div className="flex items-baseline justify-between border-b border-[#e2e8f0] pb-2">
                <span className="text-xs font-semibold text-[#18181b]">
                  {Y_METRIC_LABELS[yMetric].short}
                </span>
                <span className="font-mono text-base font-bold text-[#be185d]">
                  {(() => {
                    const v = getY(hover.point);
                    return v != null ? `${Math.round(v)} ms` : "—";
                  })()}
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-[11px]">
                {HOP_LABELS.map(({ key, label }) => {
                  const v = hover.point.latencies[key];
                  return (
                    <li
                      key={key}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="text-[#475569]">{label}</span>
                      <span className="font-mono tabular-nums text-[#18181b]">
                        {v != null ? `${Math.round(v)} ms` : "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {/* Bouton "Détails" → ouvre panel drill-down à droite */}
              <button
                type="button"
                onClick={() => {
                  setSelectedCallId(hover.point.id);
                  setHover(null);
                }}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-[#be185d] via-[#ec4899] to-[#22d3ee] px-3 py-1.5 text-[11px] font-bold text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3 w-3">
                  <path d="M3 12h18M14 5l7 7-7 7" />
                </svg>
                Détails de l'appel
              </button>
            </div>
          )}
        </div>
        {/* Panel détail à droite quand un appel est sélectionné */}
        {selectedCallId && (
          <CallDetailPanel
            point={
              data?.points.find((p) => p.id === selectedCallId) ?? null
            }
            onClose={() => setSelectedCallId(null)}
          />
        )}
      </div>
      )}

      {/* Légende */}
      <div className="mt-4 flex items-center gap-4 text-[11px] text-[#475569]">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: COLOR_BY_ORIGIN.sip.fill }}
          />
          SIP (téléphone Twilio)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: COLOR_BY_ORIGIN.web.fill }}
          />
          Web LiveTest
        </span>
      </div>
    </section>
  );
}

// ─── Panel détail (drill-down d'un appel) ────────────────────────────
//
// Affiche les 8 mesures de latence sous forme de barres horizontales
// groupées en 2 phases :
//   - SETUP (une seule fois, au session.start)
//   - RUNTIME (par tour, en moyenne sur tous les tours de l'appel)
// L'utilisateur voit la décomposition complète du round-trip et identifie
// le maillon le plus lent (ex. transcription trop longue, OpenAI réponse
// lente, etc.).

const DETAIL_GROUPS: Array<{
  title: string;
  hint: string;
  color: string;
  hops: Array<{ key: keyof LatencyPoint["latencies"]; label: string }>;
}> = [
  {
    title: "Setup (init session)",
    hint: "Phases une-seule-fois au démarrage de l'appel",
    color: "#22d3ee",
    hops: [
      { key: "twilioToWorker", label: "Twilio/Web → Worker" },
      { key: "workerToLivekit", label: "Worker → LiveKit" },
      { key: "workerToWebConfig", label: "Worker → Web (config)" },
      { key: "workerToOpenai", label: "Worker → OpenAI" },
      { key: "greeting", label: "Greeting full E2E" },
    ],
  },
  {
    title: "Runtime (par tour, moyenne)",
    hint: "Latences mesurées à chaque tour de conversation",
    color: "#ec4899",
    hops: [
      { key: "transcription", label: "Transcription (STT)" },
      { key: "endOfUtterance", label: "End of utterance (LLM)" },
      { key: "firstAudio", label: "First audio (TTS)" },
    ],
  },
];

function CallDetailPanel({
  point,
  onClose,
}: {
  point: LatencyPoint | null;
  onClose: () => void;
}) {
  if (!point) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-[#e2e8f0] bg-white/50 p-6 text-xs text-[#94a3b8]">
        Appel introuvable — fermez ce panel.
      </div>
    );
  }

  // Max sur l'ensemble des barres pour échelle uniforme dans le panel.
  const allValues = [
    ...DETAIL_GROUPS.flatMap((g) =>
      g.hops.map((h) => point.latencies[h.key]),
    ),
  ].filter((v): v is number => v != null && v > 0);
  const maxMs = allValues.length > 0 ? Math.max(...allValues) : 1;

  const totalRuntime =
    (point.latencies.transcription ?? 0) +
    (point.latencies.endOfUtterance ?? 0) +
    (point.latencies.firstAudio ?? 0);
  const totalSetup =
    (point.latencies.twilioToWorker ?? 0) +
    (point.latencies.workerToLivekit ?? 0) +
    (point.latencies.workerToWebConfig ?? 0) +
    (point.latencies.workerToOpenai ?? 0);

  return (
    <aside className="relative rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer le détail"
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-[#475569] transition-colors hover:bg-[#fee2e2] hover:text-[#dc2626]"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-4 w-4">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>

      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#475569]">
        Round-trip · {point.origin === "sip" ? "SIP (tel)" : "Web LiveTest"}
      </p>
      <h4 className="mt-1 font-display text-lg tracking-tight text-[#18181b]">
        {new Date(point.timestamp).toLocaleString("fr-FR", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      </h4>

      <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-gradient-to-br from-[#fdf2f8] to-[#ecfeff] p-2.5 text-center">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[#0e7490]">
            Setup
          </p>
          <p className="font-mono text-sm font-bold text-[#0e7490]">
            {Math.round(totalSetup)} ms
          </p>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[#be185d]">
            Runtime
          </p>
          <p className="font-mono text-sm font-bold text-[#be185d]">
            {Math.round(totalRuntime)} ms
          </p>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[#475569]">
            E2E
          </p>
          <p className="font-mono text-sm font-bold text-[#18181b]">
            {point.totalE2eMs != null
              ? `${Math.round(point.totalE2eMs)} ms`
              : "—"}
          </p>
        </div>
      </div>

      {DETAIL_GROUPS.map((group) => (
        <div key={group.title} className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#18181b]">
              {group.title}
            </p>
            <span className="text-[10px] text-[#94a3b8]">{group.hint}</span>
          </div>
          <ul className="space-y-2">
            {group.hops.map((hop) => {
              const v = point.latencies[hop.key];
              const pct = v != null && v > 0 ? (v / maxMs) * 100 : 0;
              return (
                <li key={hop.key}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[11px] text-[#475569]">
                      {hop.label}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-[#18181b]">
                      {v != null ? `${Math.round(v)} ms` : "—"}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 w-full rounded-full bg-[#f1f5f9]">
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: v != null ? group.color : "transparent",
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <p className="mt-3 text-[10px] italic text-[#94a3b8]">
        Barres à l'échelle relative (max = {Math.round(maxMs)} ms). Setup
        compté une fois ; Runtime = moyenne sur tous les tours.
      </p>
    </aside>
  );
}

/** Format un timestamp pour l'axe X selon la période sélectionnée. */
function formatTickX(ts: number, period: Period): string {
  const d = new Date(ts);
  if (period === "1h" || period === "24h") {
    return d.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  });
}
