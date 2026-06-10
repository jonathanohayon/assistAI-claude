"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { LatencyChart } from "./latency-chart";

interface EventRow {
  id: string;
  level: "info" | "warn" | "error";
  source: string;
  event: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * Un groupe d'events appartenant au même appel.
 * Identifié par roomName (events worker précoces) ou callId (events
 * post-call /api/calls/end). Le grouping fait au render via une heuristique
 * "sliding session" : chaque call_started ouvre un nouveau groupe.
 */
interface CallGroup {
  key: string;
  /** "call" si on a identifié un appel, "other" pour les events orphelins
   *  (auth, config_updated, etc.). */
  kind: "call" | "other";
  startedAt: string;
  endedAt: string;
  origin: "sip" | "web" | "unknown";
  /** Numéro ou identifier court pour le header */
  label: string;
  events: EventRow[];
  errorCount: number;
  warnCount: number;
  /** Tokens + coût USD de l'appel, extraits de l'event call_metrics. */
  totalTokens?: number;
  costUsd?: number;
}

/**
 * Groupe les events par appel via heuristique "session model" :
 *   1. Trier ASC par createdAt
 *   2. Pour chaque event :
 *      - call_started → ouvre un nouveau groupe (key = roomName)
 *      - autre event → rejoint le groupe courant s'il existe
 *      - events avant tout call_started → bucket "other"
 *   3. Renvoie les groupes en ordre DESC (plus récent en haut).
 *
 * Limite connue : si un event arrive 60s+ APRÈS le call_ended du groupe
 * en cours (ex. WhatsApp delivery check 8s), il y est quand même attaché.
 * C'est OK car on capture l'intention "events liés à cet appel".
 */
function groupEventsByCall(events: EventRow[]): CallGroup[] {
  const sortedAsc = [...events].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const groups: CallGroup[] = [];
  let currentCall: CallGroup | null = null;
  let otherGroup: CallGroup | null = null;
  const meta = (e: EventRow): Record<string, unknown> => e.metadata ?? {};

  const updateCounts = (group: CallGroup, e: EventRow) => {
    if (e.level === "error") group.errorCount++;
    if (e.level === "warn") group.warnCount++;
    group.endedAt = e.createdAt;
    group.events.push(e);
    const usage = (e.metadata ?? {})["usage"] as
      | { totalTokens?: number; costUsd?: number }
      | undefined;
    if (usage) {
      if (typeof usage.totalTokens === "number")
        group.totalTokens = usage.totalTokens;
      if (typeof usage.costUsd === "number") group.costUsd = usage.costUsd;
    }
  };

  for (const e of sortedAsc) {
    const m = meta(e);
    // Detect call boundary
    if (e.event === "call_started") {
      const roomName = (m["roomName"] as string | undefined) ?? "";
      const origin =
        (m["origin"] as { kind?: string } | undefined)?.kind ??
        (roomName.startsWith("livetest-") ? "web" : "sip");
      const label =
        origin === "web"
          ? "Web LiveTest"
          : ((m["origin"] as { calledNumber?: string } | undefined)
              ?.calledNumber ?? "SIP");
      currentCall = {
        key: roomName ? `room:${roomName}` : `call:${e.id}`,
        kind: "call",
        startedAt: e.createdAt,
        endedAt: e.createdAt,
        origin: origin === "sip" || origin === "web" ? origin : "unknown",
        label,
        events: [e],
        errorCount: e.level === "error" ? 1 : 0,
        warnCount: e.level === "warn" ? 1 : 0,
      };
      groups.push(currentCall);
      continue;
    }
    // Try to refine origin / label from late events (call_received has
    // toNumber/fromNumber, useful for SIP groups)
    if (currentCall && e.event === "call_received") {
      const to = m["toNumber"] as string | undefined;
      const from = m["fromNumber"] as string | undefined;
      if (to && currentCall.origin === "sip") {
        currentCall.label = `SIP ${from ? `${from} → ` : ""}${to}`;
      }
    }
    // Rattache l'event au groupe courant. Si pas de groupe courant
    // (= events orphelins en début de stream), on les met dans "other".
    if (currentCall) {
      updateCounts(currentCall, e);
    } else {
      if (!otherGroup) {
        otherGroup = {
          key: "other",
          kind: "other",
          startedAt: e.createdAt,
          endedAt: e.createdAt,
          origin: "unknown",
          label: "Activité hors-appel",
          events: [e],
          errorCount: e.level === "error" ? 1 : 0,
          warnCount: e.level === "warn" ? 1 : 0,
        };
        // Insère "other" au début pour qu'il apparaisse en bas après reverse
        groups.unshift(otherGroup);
      } else {
        updateCounts(otherGroup, e);
      }
    }
  }

  // Order DESC (newest first) pour l'affichage
  return groups.reverse();
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

export function LogsView({ asUserId }: { asUserId?: string } = {}) {
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
  /** Toggle grouping events par appel. Default ON = vue analyse,
   *  OFF = flat chronologique pour debug brut. */
  const [groupByCall, setGroupByCall] = useState(true);
  /** Groupes expanded — par key. Par défaut TOUS COLLAPSED (Set vide). */
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(),
  );
  const toggleGroup = (key: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const lastFetchedAt = useRef<string | null>(null);

  const fetchLogs = useCallback(async (initial: boolean) => {
    const params = new URLSearchParams();
    if (!initial && lastFetchedAt.current) {
      params.set("since", lastFetchedAt.current);
    }
    params.set("limit", "200");
    if (asUserId) params.set("asUserId", asUserId);

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
  }, [t, asUserId]);

  // Initial load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial des logs : setState après fetch, pattern voulu
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
      <LatencyChart asUserId={asUserId} />
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
            onClick={() => setGroupByCall((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
              groupByCall
                ? "bg-[#ecfeff] text-[#0e7490] ring-[#22d3ee]/40"
                : "bg-white text-[var(--color-muted-foreground)] ring-[var(--color-border)] hover:bg-[var(--color-muted)]"
            }`}
            title={
              groupByCall
                ? "Vue groupée par appel — click pour passer en flat"
                : "Vue chronologique brute — click pour regrouper par appel"
            }
          >
            {groupByCall ? "☰ Groupé" : "≡ Flat"}
          </button>
          {groupByCall && (
            <div className="inline-flex overflow-hidden rounded-full ring-1 ring-inset ring-[var(--color-border)]">
              <button
                onClick={() =>
                  setExpandedGroups(
                    new Set(groupEventsByCall(filtered).map((g) => g.key)),
                  )
                }
                className="bg-white px-3 py-1 text-xs font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
                title="Déplier tous les appels"
              >
                ⊕ Tout ouvrir
              </button>
              <span className="self-stretch w-px bg-[var(--color-border)]" />
              <button
                onClick={() => setExpandedGroups(new Set())}
                className="bg-white px-3 py-1 text-xs font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
                title="Replier tous les appels"
              >
                ⊖ Tout fermer
              </button>
            </div>
          )}
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
      {filtered.length === 0 ? (
        <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white p-8 text-center text-sm text-[var(--color-muted-foreground)] shadow-sm">
          {logs.length === 0 ? t("waitingForEvents") : t("noMatchingEvents")}
        </div>
      ) : groupByCall ? (
        <div className="space-y-3">
          {groupEventsByCall(filtered).map((group) => {
            const isCollapsed = !expandedGroups.has(group.key);
            const accent =
              group.kind === "other"
                ? "from-[#94a3b8] to-[#64748b]"
                : group.origin === "web"
                  ? "from-[#22d3ee] to-[#0e7490]"
                  : "from-[#ec4899] to-[#be185d]";
            const startMs = new Date(group.startedAt).getTime();
            const endMs = new Date(group.endedAt).getTime();
            const durationS = Math.max(0, Math.round((endMs - startMs) / 1000));
            return (
              <div
                key={group.key}
                className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm"
              >
                {/* Group header */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className="flex w-full items-center justify-between gap-3 border-b border-[var(--color-border)]/60 bg-gradient-to-br from-white to-[#f8fafc] px-4 py-3 text-left transition-colors hover:bg-[#f1f5f9]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${accent} text-white shadow-sm`}
                    >
                      {group.kind === "other" ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 8v4M12 16h.01" />
                        </svg>
                      ) : group.origin === "web" ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                          <path d="M6.6 10.8a13 13 0 0 0 5.8 5.8l1.9-1.9a1 1 0 0 1 1-.3 11.4 11.4 0 0 0 3.6.6 1 1 0 0 1 1 1V19a1 1 0 0 1-1 1A17 17 0 0 1 4 5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1c0 1.2.2 2.4.6 3.6a1 1 0 0 1-.3 1l-2 1Z" />
                        </svg>
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#18181b]">
                        {group.label}
                      </p>
                      <p className="text-[11px] text-[#475569]">
                        {new Date(group.startedAt).toLocaleTimeString(timeLocale, {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}{" "}
                        · {group.events.length} event{group.events.length > 1 ? "s" : ""}
                        {group.kind === "call" && durationS > 0 && (
                          <> · durée ~{durationS}s</>
                        )}
                        {group.kind === "call" &&
                          typeof group.totalTokens === "number" && (
                            <>
                              {" "}
                              ·{" "}
                              <span className="font-medium text-[#0e7490]">
                                {group.totalTokens.toLocaleString(timeLocale)} tokens
                                {typeof group.costUsd === "number" && (
                                  <> ~${group.costUsd.toFixed(4)}</>
                                )}
                              </span>
                            </>
                          )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {group.errorCount > 0 && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                        {group.errorCount} err
                      </span>
                    )}
                    {group.warnCount > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        {group.warnCount} warn
                      </span>
                    )}
                    <span className="text-[#94a3b8]">
                      {isCollapsed ? "▶" : "▼"}
                    </span>
                  </div>
                </button>
                {/* Events list */}
                {!isCollapsed && (
                  <ul className="divide-y divide-[var(--color-border)]/40">
                    {/* Affichage DESC (newest first) inside the group */}
                    {[...group.events].reverse().map((l) =>
                      renderEventRow(l, expanded, toggleExpand, timeLocale),
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
          <ul className="divide-y divide-[var(--color-border)]/60">
            {filtered.map((l) =>
              renderEventRow(l, expanded, toggleExpand, timeLocale),
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Render row event partagé entre le mode groupé et le mode flat.
 * Extrait pour ne pas dupliquer 50 lignes de JSX. Renvoie un <li>.
 */
function renderEventRow(
  l: EventRow,
  expanded: Set<string>,
  toggleExpand: (id: string) => void,
  timeLocale: string,
) {
  const isExpanded = expanded.has(l.id);
  const hasMetadata = l.metadata && Object.keys(l.metadata).length > 0;
  return (
    <li
      key={l.id}
      className="px-3 py-3 hover:bg-[var(--color-muted)]/30 sm:px-4"
    >
      <button
        onClick={() => hasMetadata && toggleExpand(l.id)}
        disabled={!hasMetadata}
        className="flex w-full flex-col gap-1.5 text-left disabled:cursor-default sm:flex-row sm:items-start sm:gap-3"
      >
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
}
