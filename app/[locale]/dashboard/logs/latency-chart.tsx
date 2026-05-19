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
  // Arrays per tour pour le drill-down line chart. Index = numéro de tour.
  perTurn?: {
    ttft: number[];
    eou: number[];
    transcription: number[];
    firstAudio: number[];
  };
  /** Topologie infra — où tourne chaque composant. Snapshot par appel. */
  topology?: {
    twilio?: string;
    worker?: string;
    web?: string;
    livekit?: string;
    openai?: string;
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

export function LatencyChart({ asUserId }: { asUserId?: string } = {}) {
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
        const qs = new URLSearchParams({ period });
        if (asUserId) qs.set("asUserId", asUserId);
        const res = await fetch(
          `/api/dashboard/call-metrics?${qs}`,
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
  }, [period, paused, asUserId]);

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

// ─── Panel détail (drill-down d'un appel — multi-line time-series) ────
//
// Affiche les latences runtime par tour de conversation sous forme de
// line chart multi-séries.
//   - X : tour de la conversation (1, 2, 3…) = ordre chronologique
//   - Y : latence en ms
//   - 4 lignes colorées : transcription / EOU LLM / first audio TTS / TTFA total
//
// Setup phases (one-shot init) affichées en chips au-dessus du chart,
// car elles n'ont pas de dimension "par tour" — c'est de la latence
// d'initialisation, pas de runtime.

interface SeriesDef {
  key: keyof NonNullable<LatencyPoint["perTurn"]>;
  label: string;
  color: string;
  hint: string;
}

/** 4 phases RETOUR (runtime, mesuré à chaque tour). */
const PERTURN_SERIES: ReadonlyArray<SeriesDef> = [
  {
    key: "transcription",
    label: "STT → Worker (transcription)",
    color: "#22d3ee",
    hint: "Temps user-finit-de-parler → STT done. Retour OpenAI→Worker.",
  },
  {
    key: "eou",
    label: "LLM → Worker (end of utterance)",
    color: "#f472b6",
    hint: "Temps user-finit → LLM commence à répondre. Retour OpenAI→Worker.",
  },
  {
    key: "firstAudio",
    label: "Audio → Worker (1er chunk)",
    color: "#f59e0b",
    hint: "Temps LLM-start → 1er son audible. Retour OpenAI→Worker.",
  },
  {
    key: "ttft",
    label: "Worker → User (TTFA total)",
    color: "#7c3aed",
    hint: "Retour final user-perçu : user finit → agent émet 1er son.",
  },
];

/** 4 phases ALLER (setup, mesuré une fois au session.start). */
const SETUP_SERIES: ReadonlyArray<{
  key: keyof LatencyPoint["latencies"];
  label: string;
  color: string;
}> = [
  { key: "twilioToWorker", label: "Twilio/Web → Worker", color: "#06b6d4" },
  { key: "workerToLivekit", label: "Worker → LiveKit", color: "#0e7490" },
  { key: "workerToWebConfig", label: "Worker → Web (config)", color: "#ec4899" },
  { key: "workerToOpenai", label: "Worker → OpenAI", color: "#be185d" },
];

function CallDetailPanel({
  point,
  onClose,
}: {
  point: LatencyPoint | null;
  onClose: () => void;
}) {
  // État du hover sur un point de la time-series (pour tooltip)
  const [seriesHover, setSeriesHover] = useState<{
    series: SeriesDef;
    turnIndex: number;
    value: number;
    x: number;
    y: number;
  } | null>(null);
  // Toggles de visibilité par série. Toutes activées par défaut.
  // Clés : "setup:<key>" pour les phases aller, "runtime:<key>" pour le retour.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const isVisible = (id: string) => !hidden.has(id);
  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!point) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-[#e2e8f0] bg-white/50 p-6 text-xs text-[#94a3b8]">
        Appel introuvable — fermez ce panel.
      </div>
    );
  }

  // Chart geometry — compact pour rentrer dans le 360px du panel
  const CHART_W = 320;
  const CHART_H = 180;
  const PAD = { top: 12, right: 12, bottom: 28, left: 40 };
  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;

  // Nombre max de tours toutes séries confondues
  const turns = point.perTurn
    ? Math.max(
        point.perTurn.ttft.length,
        point.perTurn.eou.length,
        point.perTurn.transcription.length,
        point.perTurn.firstAudio.length,
      )
    : 0;

  // Setup values pour les lignes de référence horizontales
  const setupValues = SETUP_SERIES.map((s) => ({
    ...s,
    value: point.latencies[s.key],
  })).filter(
    (s): s is typeof s & { value: number } => s.value != null && s.value > 0,
  );

  // Max value pour échelle Y — runtime + setup (pour que les lignes
  // setup soient visibles sur le chart, même si elles sont plus hautes
  // que le max runtime).
  const allValues = point.perTurn
    ? [
        ...point.perTurn.ttft,
        ...point.perTurn.eou,
        ...point.perTurn.transcription,
        ...point.perTurn.firstAudio,
      ].filter((v) => v != null && v > 0)
    : [];
  const allValuesIncludingSetup = [
    ...allValues,
    ...setupValues.map((s) => s.value),
  ];
  const yMax =
    allValuesIncludingSetup.length > 0
      ? Math.max(...allValuesIncludingSetup) * 1.1
      : 1000;

  // Scales — turns 1-indexed sur l'axe X
  const xTo = (turn: number) =>
    PAD.left + (turns <= 1 ? plotW / 2 : ((turn - 1) / (turns - 1)) * plotW);
  const yTo = (v: number) =>
    PAD.top + plotH - (v / Math.max(1, yMax)) * plotH;

  // Y ticks (4)
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const v = (yMax * (4 - i)) / 4;
    return { y: yTo(v), label: `${Math.round(v)}` };
  });

  // Construit le path SVG pour une série
  const buildPath = (arr: number[]): string => {
    if (arr.length === 0) return "";
    return arr
      .map((v, i) => {
        const x = xTo(i + 1);
        const y = yTo(v > 0 ? v : 0);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };

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
        Détail · {point.origin === "sip" ? "SIP (tel)" : "Web LiveTest"}
      </p>
      <h4 className="mt-1 font-display text-base tracking-tight text-[#18181b]">
        {new Date(point.timestamp).toLocaleString("fr-FR", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}{" "}
        · {turns > 0 ? `${turns} tour${turns > 1 ? "s" : ""}` : "0 tour"}
      </h4>

      {/* Multi-line chart par tour */}
      <div className="mt-3">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#475569]">
          Round-trip par tour (X = #tour, Y = ms)
        </p>
        {turns === 0 ? (
          <p className="rounded-lg bg-[#f8fafc] py-6 text-center text-xs text-[#94a3b8]">
            Aucun tour de conversation enregistré pour cet appel.
          </p>
        ) : (
          <div className="relative">
            <svg
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              width="100%"
              preserveAspectRatio="xMidYMid meet"
              className="block"
            >
              {/* Grid Y */}
              {yTicks.map((t, i) => (
                <line
                  key={i}
                  x1={PAD.left}
                  x2={CHART_W - PAD.right}
                  y1={t.y}
                  y2={t.y}
                  stroke="#e2e8f0"
                  strokeWidth={1}
                  strokeDasharray={i === yTicks.length - 1 ? "0" : "3 3"}
                />
              ))}
              {yTicks.map((t, i) => (
                <text
                  key={i}
                  x={PAD.left - 4}
                  y={t.y + 3}
                  textAnchor="end"
                  fontSize={9}
                  fill="#94a3b8"
                  fontFamily="ui-monospace, monospace"
                >
                  {t.label}
                </text>
              ))}
              {/* X labels (tour 1, ..., N — max 6 ticks pour rester lisible) */}
              {(() => {
                const stride = Math.max(1, Math.ceil(turns / 6));
                const ticks: number[] = [];
                for (let i = 1; i <= turns; i += stride) ticks.push(i);
                if (ticks[ticks.length - 1] !== turns) ticks.push(turns);
                return ticks.map((tn) => (
                  <text
                    key={tn}
                    x={xTo(tn)}
                    y={CHART_H - PAD.bottom + 14}
                    textAnchor="middle"
                    fontSize={9}
                    fill="#94a3b8"
                    fontFamily="ui-monospace, monospace"
                  >
                    {tn}
                  </text>
                ));
              })()}
              {/* Axe X bottom */}
              <line
                x1={PAD.left}
                x2={CHART_W - PAD.right}
                y1={CHART_H - PAD.bottom}
                y2={CHART_H - PAD.bottom}
                stroke="#cbd5e1"
                strokeWidth={1}
              />
              {/* Lignes horizontales pointillées pour les phases SETUP
                  (constantes — mesurées une fois au session.start) */}
              {setupValues
                .filter((s) => isVisible(`setup:${s.key}`))
                .map((s) => {
                const y = yTo(s.value);
                return (
                  <g key={`setup-${s.key}`}>
                    <line
                      x1={PAD.left}
                      x2={CHART_W - PAD.right}
                      y1={y}
                      y2={y}
                      stroke={s.color}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      opacity={0.65}
                    />
                    {/* Petit label inline à droite */}
                    <text
                      x={CHART_W - PAD.right - 2}
                      y={y - 3}
                      textAnchor="end"
                      fontSize={8}
                      fill={s.color}
                      fontFamily="ui-monospace, monospace"
                    >
                      {s.label.split(" → ")[1] ?? s.label} · {Math.round(s.value)}
                    </text>
                  </g>
                );
              })}
              {/* Lignes par série + points hoverables */}
              {PERTURN_SERIES.filter((s) => isVisible(`runtime:${s.key}`)).map((s) => {
                const arr = point.perTurn?.[s.key] ?? [];
                if (arr.length === 0) return null;
                return (
                  <g key={s.key}>
                    <path
                      d={buildPath(arr)}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {arr.map((v, i) => (
                      <circle
                        key={i}
                        cx={xTo(i + 1)}
                        cy={yTo(v > 0 ? v : 0)}
                        r={
                          seriesHover &&
                          seriesHover.series.key === s.key &&
                          seriesHover.turnIndex === i
                            ? 5
                            : 3
                        }
                        fill="white"
                        stroke={s.color}
                        strokeWidth={2}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={(e) => {
                          const svg = e.currentTarget.ownerSVGElement;
                          if (!svg) return;
                          const rect = svg.getBoundingClientRect();
                          const scale = rect.width / CHART_W;
                          setSeriesHover({
                            series: s,
                            turnIndex: i,
                            value: v,
                            x: xTo(i + 1) * scale,
                            y: yTo(v > 0 ? v : 0) * scale,
                          });
                        }}
                        onMouseLeave={() => setSeriesHover(null)}
                      />
                    ))}
                  </g>
                );
              })}
            </svg>
            {/* Tooltip point hover */}
            {seriesHover && (
              <div
                className="pointer-events-none absolute z-10 rounded-lg border border-[#e2e8f0] bg-white px-2 py-1.5 text-[10px] shadow-md"
                style={{
                  left: Math.min(seriesHover.x + 8, 220),
                  top: Math.max(seriesHover.y - 36, 0),
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: seriesHover.series.color }}
                  />
                  <span className="font-semibold text-[#18181b]">
                    {seriesHover.series.label}
                  </span>
                </div>
                <div className="mt-0.5 text-[#475569]">
                  Tour #{seriesHover.turnIndex + 1} ·{" "}
                  <span className="font-mono font-bold text-[#18181b]">
                    {Math.round(seriesHover.value)} ms
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Légende unifiée — 8 lignes (4 aller setup pointillés + 4
         *  retour runtime pleins), toggleables au click. */}
        <div className="mt-3 space-y-2">
          {/* Section ALLER (setup) */}
          <div>
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-[#0e7490]">
              ↗ Aller (setup, lignes pointillées)
            </p>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
              {SETUP_SERIES.map((s) => {
                const v = point.latencies[s.key];
                const empty = v == null || v <= 0;
                const id = `setup:${s.key}`;
                const visible = isVisible(id);
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => toggle(id)}
                    disabled={empty}
                    className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-50 ${
                      !visible ? "opacity-40" : ""
                    }`}
                    title={`Click pour ${visible ? "masquer" : "afficher"} · ${s.label}`}
                  >
                    <span
                      className="h-0.5 w-4 shrink-0"
                      style={{
                        background: empty
                          ? "#cbd5e1"
                          : `repeating-linear-gradient(to right, ${s.color} 0 3px, transparent 3px 5px)`,
                      }}
                    />
                    <span
                      className={`flex-1 truncate text-[10px] ${
                        empty ? "text-[#94a3b8] line-through" : "text-[#475569]"
                      }`}
                    >
                      {s.label}
                    </span>
                    {!empty && (
                      <span className="font-mono text-[9px] font-semibold tabular-nums text-[#18181b]">
                        {Math.round(v)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Section RETOUR (runtime) */}
          <div>
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-[#be185d]">
              ↘ Retour (runtime par tour, lignes pleines)
            </p>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
              {PERTURN_SERIES.map((s) => {
                const arr = point.perTurn?.[s.key] ?? [];
                const empty = arr.length === 0;
                const id = `runtime:${s.key}`;
                const visible = isVisible(id);
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => toggle(id)}
                    disabled={empty}
                    className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-50 ${
                      !visible ? "opacity-40" : ""
                    }`}
                    title={`Click pour ${visible ? "masquer" : "afficher"} · ${s.hint}`}
                  >
                    <span
                      className="h-0.5 w-4 shrink-0 rounded-full"
                      style={{ backgroundColor: empty ? "#cbd5e1" : s.color }}
                    />
                    <span
                      className={`flex-1 truncate text-[10px] ${
                        empty ? "text-[#94a3b8] line-through" : "text-[#475569]"
                      }`}
                    >
                      {s.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Topologie infra — où tourne chaque composant pour cet appel.
            Aide à expliquer une latence (e.g. worker EU ↔ OpenAI US =
            ~120ms RTT incompressible). */}
        {point.topology && (
          <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
            <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-[#475569]">
              🌍 Topologie infra
            </p>
            <dl className="grid grid-cols-1 gap-1 text-[11px]">
              {(
                [
                  ["Twilio", point.topology.twilio, "#ec4899"],
                  ["Worker", point.topology.worker, "#be185d"],
                  ["Web", point.topology.web, "#22d3ee"],
                  ["LiveKit", point.topology.livekit, "#0e7490"],
                  ["OpenAI", point.topology.openai, "#7c3aed"],
                ] as const
              ).map(([label, value, color]) => (
                <div
                  key={label}
                  className="flex items-baseline justify-between gap-2"
                >
                  <dt className="flex items-center gap-1.5 text-[#475569]">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="font-medium">{label}</span>
                  </dt>
                  <dd className="truncate font-mono text-[10px] tabular-nums text-[#18181b]">
                    {value || "—"}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
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
