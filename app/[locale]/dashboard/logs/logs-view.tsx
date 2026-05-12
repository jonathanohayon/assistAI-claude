"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

interface EventRow {
  id: string;
  level: "info" | "warn" | "error";
  source: string;
  event: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

const LEVEL_FILTERS = ["info", "warn", "error"] as const;

const SOURCE_BADGE: Record<string, string> = {
  agent: "bg-blue-100 text-blue-800 ring-blue-200",
  latency: "bg-orange-100 text-orange-800 ring-orange-200 font-semibold",
  sync: "bg-cyan-100 text-cyan-800 ring-cyan-200",
  calendar: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  sheets: "bg-amber-100 text-amber-800 ring-amber-200",
  whatsapp: "bg-green-100 text-green-800 ring-green-200",
  summary: "bg-violet-100 text-violet-800 ring-violet-200",
  auth: "bg-zinc-100 text-zinc-800 ring-zinc-200",
  tenant: "bg-pink-100 text-pink-800 ring-pink-200",
  web: "bg-sky-100 text-sky-800 ring-sky-200",
};

const LEVEL_BADGE: Record<string, string> = {
  info: "text-[var(--color-muted-foreground)]",
  warn: "text-amber-600 font-medium",
  error: "text-red-600 font-semibold",
};

export function LogsView() {
  const t = useTranslations("DashboardLogs");
  const locale = useLocale();
  const timeLocale = locale === "he" ? "he-IL" : locale === "en" ? "en-US" : "fr-FR";

  // Reconstruit la liste à chaque render pour bénéficier des labels traduits.
  // 10 entrées seulement → coût négligeable.
  const sourceFilters = [
    { id: "agent", label: t("sourceAgent") },
    { id: "latency", label: t("sourceLatency") },
    { id: "sync", label: t("sourceSync") },
    { id: "calendar", label: t("sourceCalendar") },
    { id: "sheets", label: t("sourceSheets") },
    { id: "whatsapp", label: t("sourceWhatsapp") },
    { id: "summary", label: t("sourceSummary") },
    { id: "auth", label: t("sourceAuth") },
    { id: "tenant", label: t("sourceTenant") },
    { id: "web", label: t("sourceWeb") },
  ];

  const [logs, setLogs] = useState<EventRow[]>([]);
  const [paused, setPaused] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set());
  const [levelFilter, setLevelFilter] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const lastFetchedAt = useRef<string | null>(null);

  const fetchLogs = useCallback(async (initial: boolean) => {
    const params = new URLSearchParams();
    if (!initial && lastFetchedAt.current) {
      params.set("since", lastFetchedAt.current);
    }
    params.set("limit", "200");

    try {
      const res = await fetch(`/api/dashboard/events?${params}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as {
        events: EventRow[];
        serverTime: string;
      };
      setError(null);
      lastFetchedAt.current = data.serverTime;

      if (initial) {
        setLogs(data.events);
      } else if (data.events.length > 0) {
        setLogs((prev) => {
          const merged = [...data.events, ...prev];
          // Cap at 1000 entries client-side
          return merged.slice(0, 1000);
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("fetchError"));
    }
  }, [t]);

  // Initial load
  useEffect(() => {
    fetchLogs(true);
  }, [fetchLogs]);

  // Poll every 3s while not paused
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => fetchLogs(false), 3000);
    return () => clearInterval(id);
  }, [paused, fetchLogs]);

  const toggleSource = (s: string) => {
    setSourceFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const toggleLevel = (l: string) => {
    setLevelFilter((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = logs.filter((l) => {
    if (sourceFilter.size > 0 && !sourceFilter.has(l.source)) return false;
    if (levelFilter.size > 0 && !levelFilter.has(l.level)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
            {t("sourceFilterLabel")}
          </span>
          {sourceFilters.map((s) => (
            <button
              key={s.id}
              onClick={() => toggleSource(s.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition-colors ${
                sourceFilter.has(s.id)
                  ? SOURCE_BADGE[s.id] || "bg-[var(--color-muted)]"
                  : "bg-white text-[var(--color-muted-foreground)] ring-[var(--color-border)] hover:bg-[var(--color-muted)]"
              }`}
            >
              {s.label}
            </button>
          ))}
          <span className="ml-2 text-xs font-medium text-[var(--color-muted-foreground)]">
            {t("levelFilterLabel")}
          </span>
          {LEVEL_FILTERS.map((l) => (
            <button
              key={l}
              onClick={() => toggleLevel(l)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition-colors ${
                levelFilter.has(l)
                  ? l === "error"
                    ? "bg-red-100 text-red-800 ring-red-200"
                    : l === "warn"
                    ? "bg-amber-100 text-amber-800 ring-amber-200"
                    : "bg-blue-100 text-blue-800 ring-blue-200"
                  : "bg-white text-[var(--color-muted-foreground)] ring-[var(--color-border)] hover:bg-[var(--color-muted)]"
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {t("countDisplayed", { count: filtered.length, total: logs.length })}
          </span>
          <button
            onClick={() => setPaused((p) => !p)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
              paused
                ? "bg-amber-50 text-amber-800 ring-amber-200"
                : "bg-emerald-50 text-emerald-800 ring-emerald-200"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                paused ? "bg-amber-500" : "bg-emerald-500 animate-pulse"
              }`}
            />
            {paused ? t("pauseButton") : t("liveButton")}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Log feed */}
      <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-muted-foreground)]">
            {logs.length === 0
              ? t("waitingForEvents")
              : t("noMatchingEvents")}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]/60">
            {filtered.map((l) => {
              const isExpanded = expanded.has(l.id);
              const hasMetadata =
                l.metadata && Object.keys(l.metadata).length > 0;
              return (
                <li key={l.id} className="px-3 py-3 hover:bg-[var(--color-muted)]/30 sm:px-4">
                  <button
                    onClick={() => hasMetadata && toggleExpand(l.id)}
                    disabled={!hasMetadata}
                    className="flex w-full flex-col gap-1.5 text-left disabled:cursor-default sm:flex-row sm:items-start sm:gap-3"
                  >
                    {/* Header row : timestamp + source + event sur 1 ligne sur
                        mobile, fait partie du flex row sur sm+. */}
                    <div className="flex items-center gap-2 sm:contents">
                      <span className="whitespace-nowrap font-mono text-[10px] text-[var(--color-muted-foreground)]">
                        {new Date(l.createdAt).toLocaleTimeString(timeLocale, {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                      <span
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
                          SOURCE_BADGE[l.source] ||
                          "bg-zinc-100 text-zinc-800 ring-zinc-200"
                        }`}
                      >
                        {l.source}
                      </span>
                      <span className="truncate font-mono text-[10px] text-[var(--color-muted-foreground)]">
                        {l.event}
                      </span>
                    </div>
                    <span
                      className={`min-w-0 flex-1 break-words text-xs sm:text-sm ${LEVEL_BADGE[l.level]}`}
                    >
                      {l.message}
                      {hasMetadata && (
                        <span className="ml-2 text-[11px] text-[var(--color-muted-foreground)]">
                          {isExpanded ? "▼" : "▶"}
                        </span>
                      )}
                    </span>
                  </button>
                  {isExpanded && hasMetadata && (
                    <pre className="mt-2 max-w-full overflow-x-auto rounded-lg bg-[var(--color-muted)]/60 px-3 py-2 font-mono text-[10px] text-[var(--color-foreground)] sm:text-[11px]">
                      {JSON.stringify(l.metadata, null, 2)}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
