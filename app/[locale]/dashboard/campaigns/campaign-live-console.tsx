"use client";

/**
 * Live console of an outbound campaign (admin-only): what the dialer is doing
 * right now. Polls GET /api/dashboard/campaigns/:id/live every 2.5 s while the
 * tab is visible, stops when hidden. A 403 (non-admin) renders nothing.
 *
 * Used by: campaigns-workspace.tsx (launch step, under CampaignLaunch).
 */

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  actionErrorKey,
  contactView,
  counterBuckets,
  dispatchNoticeKey,
  eventLine,
  formatElapsed,
  mergeEvents,
  readyPill,
  showDispatcherAlert,
  nextSince,
  tickSkips,
  type ActionErrorKey,
  type DispatchMode,
  type LiveContact,
  type LiveEvent,
  type LiveFeed,
} from "@/lib/campaigns/live-view";

const POLL_MS = 2500;
const MAX_BACKOFF_MS = 20000;
/** A dispatcher tick older than this means the cron has stopped reaching us. */
const STALE_TICK_MS = 5 * 60 * 1000;
const CONTACTS_SHOWN = 50;

type Snapshot = Omit<LiveFeed, "events"> & { fetchedAt: number };

export function CampaignLiveConsole({
  campaignId,
  asUserId,
  onStatusChanged,
}: {
  campaignId: string;
  /** Admin acting on a tenant's campaign (/admin/users/[id]). */
  asUserId?: string;
  onStatusChanged?: (status: string) => void;
}) {
  const t = useTranslations("DashboardCampaigns.live");
  const locale = useLocale();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  // A refused start / pause, in words (never a silent no-op).
  const [actionError, setActionError] = useState<{ action: "pause" | "start"; key: ActionErrorKey } | null>(null);
  // The call switch as the start answered it, until the next snapshot says it.
  const [postedMode, setPostedMode] = useState<DispatchMode | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [clock, setClock] = useState(() => Date.now());

  const eventsRef = useRef<LiveEvent[]>([]);
  const lastStatusRef = useRef<string | null>(null);
  const onStatusRef = useRef(onStatusChanged);
  // Latest callback for the poller; written after render, before the
  // polling effect below runs (effects run in declaration order).
  useEffect(() => {
    onStatusRef.current = onStatusChanged;
  });

  // ─── Polling: only while visible; backoff on errors ───────────────────
  const pollNow = useRef<() => void>(() => {});
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ctrl: AbortController | null = null;
    let failures = 0;
    let stopped = false;

    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      if (!stopped && document.visibilityState === "visible") timer = setTimeout(run, ms);
    };

    async function run() {
      timer = null;
      if (stopped || document.visibilityState !== "visible") return;
      ctrl?.abort();
      ctrl = new AbortController();
      const since = nextSince(eventsRef.current);
      const qs = since ? `?since=${encodeURIComponent(since)}` : "";
      try {
        const res = await fetch(`/api/dashboard/campaigns/${campaignId}/live${qs}`, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (res.status === 403) {
          stopped = true;
          setForbidden(true);
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const feed = (await res.json()) as LiveFeed;
        const { events: incoming, ...rest } = feed;
        eventsRef.current = mergeEvents(eventsRef.current, incoming);
        setEvents(eventsRef.current);
        setSnap({ ...rest, fetchedAt: Date.now() });
        setOffline(false);
        failures = 0;
        if (lastStatusRef.current !== null && lastStatusRef.current !== rest.campaign.status)
          onStatusRef.current?.(rest.campaign.status);
        lastStatusRef.current = rest.campaign.status;
        schedule(POLL_MS);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        failures++;
        setOffline(true);
        schedule(Math.min(POLL_MS * 2 ** failures, MAX_BACKOFF_MS));
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") run();
      else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    pollNow.current = () => run();
    document.addEventListener("visibilitychange", onVisibility);
    run();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [campaignId]);

  // Local 1 s clock so call durations tick between polls.
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Server "now" advanced by the time elapsed since the fetch (no client skew).
  const now = useMemo(
    () => (snap ? new Date(Date.parse(snap.now) + (clock - snap.fetchedAt)) : new Date(clock)),
    [snap, clock],
  );

  const contactsById = useMemo(() => {
    const m = new Map<string, LiveContact>();
    for (const c of snap?.contacts ?? []) m.set(c.contactId, c);
    for (const c of snap?.inProgress ?? []) m.set(c.contactId, c);
    return m;
  }, [snap]);

  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    [locale],
  );
  const shortFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" }),
    [locale],
  );

  const ago = useCallback(
    (iso: string) => {
      const s = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
      if (s < 60) return t("agoSeconds", { n: s });
      if (s < 3600) return t("agoMinutes", { n: Math.floor(s / 60) });
      if (s < 86400) return t("agoHours", { n: Math.floor(s / 3600) });
      return t("agoDays", { n: Math.floor(s / 86400) });
    },
    [now, t],
  );

  const act = async (action: "pause" | "start") => {
    if (busy) return;
    setBusy(true);
    try {
      const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
      const res = await fetch(`/api/dashboard/campaigns/${campaignId}/status${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json().catch(() => null)) as { campaign?: { status: string }; dispatchMode?: DispatchMode } | null;
      if (res.ok && body?.campaign) {
        setActionError(null);
        if (body.dispatchMode) setPostedMode(body.dispatchMode);
        lastStatusRef.current = body.campaign.status;
        onStatusRef.current?.(body.campaign.status);
      } else {
        setActionError({ action, key: actionErrorKey(res.status, body) });
      }
    } catch {
      setActionError({ action, key: actionErrorKey(null, null) });
    } finally {
      setBusy(false);
      pollNow.current();
    }
  };

  if (forbidden) return null;

  if (!snap) {
    return (
      <section className="rounded-2xl border border-[#e2e8f0] bg-white p-4" aria-busy="true">
        <ConsoleTitle t={t} live={false} />
        <div className="mt-3 h-24 animate-pulse rounded-xl bg-[#f1f5f9] motion-reduce:animate-none" />
      </section>
    );
  }

  const { campaign, dispatcher } = snap;
  const buckets = counterBuckets(snap.counts);
  const tick = dispatcher.lastTick;
  // Platform call switch as last seen: the live snapshot first, then the start's answer.
  const mode = dispatcher.dispatchMode ?? postedMode;
  const pill = readyPill(mode, dispatcher.blockers);
  const tickStale = tick ? now.getTime() - Date.parse(tick.at) > STALE_TICK_MS : false;
  const running = campaign.status === "running";
  const paused = campaign.status === "paused";
  const shownContacts = showAll ? snap.contacts : snap.contacts.slice(0, CONTACTS_SHOWN);

  const who = (contactId: string | null) => {
    if (!contactId) return "";
    const c = contactsById.get(contactId);
    return c ? c.name || c.phoneNumber : "";
  };

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-[#e2e8f0] bg-white p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <ConsoleTitle t={t} live={running && !offline} />
          <p className="mt-0.5 text-[11px] text-[#64748b]" aria-live="polite">
            {offline ? (
              <span className="font-medium text-[#b45309]">{t("offline")}</span>
            ) : (
              t("updated", { ago: ago(snap.now) })
            )}
          </p>
        </div>
        {(running || paused) && (
          <button
            type="button"
            onClick={() => act(running ? "pause" : "start")}
            disabled={busy}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold transition disabled:opacity-50 ${
              running
                ? "border border-[#e2e8f0] bg-white text-[#18181b] hover:bg-[#f8fafc]"
                : "bg-gradient-to-br from-[#c2410c] to-[#db2777] text-white shadow-sm"
            }`}
          >
            {running ? <PauseIcon /> : <PlayIcon />}
            {running ? t("pause") : t("resume")}
          </button>
        )}
      </div>

      {actionError && (
        <p role="alert" className="text-[12px] font-semibold text-[#b91c1c]">
          {t(`actionError.${actionError.key}`, { action: actionError.action })}
        </p>
      )}
      {/* Calls switched off or in test mode on this platform: say so, never a silent start. */}
      {(() => {
        const key = running ? dispatchNoticeKey(mode) : null;
        return key ? (
          <p role="status" className="flex items-center gap-2 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-[12px] font-semibold text-[#92400e]">
            <AlertIcon className="h-4 w-4 shrink-0 text-[#b45309]" />
            {t(key)}
          </p>
        ) : null;
      })()}

      {/* Dispatcher health — LOUD when it never ran or stopped running.
          Not while calls are off: the pause line above already says why nothing dials. */}
      {!showDispatcherAlert(mode) ? null : tick === null ? (
        <div role="alert" className="flex gap-3 rounded-xl border-2 border-[#dc2626] bg-[#fef2f2] p-3">
          <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-[#dc2626]" />
          <div>
            <p className="text-[13px] font-bold text-[#991b1b]">{t("neverRanTitle")}</p>
            <p className="mt-0.5 text-[12px] text-[#7f1d1d]">{t("neverRanBody")}</p>
          </div>
        </div>
      ) : tickStale ? (
        <div role="alert" className="flex gap-3 rounded-xl border border-[#f59e0b] bg-[#fffbeb] p-3">
          <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-[#b45309]" />
          <div>
            <p className="text-[13px] font-bold text-[#92400e]">{t("staleTitle", { ago: ago(tick.at) })}</p>
            <p className="mt-0.5 text-[12px] text-[#78350f]">{t("staleBody")}</p>
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-[#475569]">
          {t("lastTick", {
            ago: ago(tick.at),
            source: t(tick.source === "start" ? "sourceStart" : "sourceCron"),
            dialed: tick.dialed,
          })}
        </p>
      )}

      {/* Blockers as plain-language chips */}
      <div className="flex flex-wrap gap-2">
        {pill ? (
          <Chip tone={pill.tone}>{t(pill.key)}</Chip>
        ) : (
          dispatcher.blockers.map((b) => (
            <Chip key={b} tone={b === "concurrency_full" ? "info" : "warn"}>
              {t(`blocker_${b}`, {
                start: campaign.callWindow.startHour,
                end: campaign.callWindow.endHour,
                tz: campaign.callWindow.timezone,
                inFlight: dispatcher.inFlight,
                max: campaign.concurrency,
              })}
            </Chip>
          ))
        )}
      </div>

      {/* Counters */}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Counter label={t("countQueued")} value={buckets.queued} tone="slate" />
        <Counter label={t("countCalling")} value={buckets.calling} tone="cyan" pulse={buckets.calling > 0} />
        <Counter label={t("countDone")} value={buckets.done} tone="green" />
        <Counter label={t("countFailed")} value={buckets.failed} tone="rose" />
      </dl>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* Calls in progress + contacts */}
        <div className="flex min-w-0 flex-col gap-4">
          <div>
            <h5 className="mb-2 text-[12px] font-bold text-[#334155]">
              {t("inProgressTitle", { n: snap.inProgress.length, max: campaign.concurrency })}
            </h5>
            {snap.inProgress.length === 0 ? (
              <p className="rounded-xl bg-[#f8fafc] px-3 py-3 text-[12px] text-[#64748b]">{t("inProgressEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {snap.inProgress.map((c) => (
                  <ContactRow key={c.contactId} c={c} now={now} t={t} shortFmt={shortFmt} highlight />
                ))}
              </ul>
            )}
          </div>

          <div>
            <h5 className="mb-2 text-[12px] font-bold text-[#334155]">
              {t("contactsTitle", { n: snap.contactsTotal })}
            </h5>
            <ul className="flex max-h-[420px] flex-col gap-1 overflow-y-auto pe-1">
              {shownContacts.map((c) => (
                <ContactRow key={c.contactId} c={c} now={now} t={t} shortFmt={shortFmt} />
              ))}
            </ul>
            {snap.contacts.length > CONTACTS_SHOWN && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="mt-2 text-[12px] font-semibold text-[#c2410c] hover:underline"
              >
                {showAll ? t("showLess") : t("showAll", { n: snap.contacts.length })}
              </button>
            )}
            {snap.contactsTotal > snap.contacts.length && (
              <p className="mt-1 text-[11px] text-[#94a3b8]">
                {t("contactsCapped", { shown: snap.contacts.length, total: snap.contactsTotal })}
              </p>
            )}
          </div>
        </div>

        {/* Activity log */}
        <div className="min-w-0">
          <h5 className="mb-2 text-[12px] font-bold text-[#334155]">{t("logTitle")}</h5>
          {events.length === 0 ? (
            <p className="rounded-xl bg-[#f8fafc] px-3 py-3 text-[12px] text-[#64748b]">{t("logEmpty")}</p>
          ) : (
            <ol className="flex max-h-[560px] flex-col overflow-y-auto rounded-xl border border-[#e2e8f0]" aria-live="off">
              {events.map((e) => {
                const line = eventLine(e);
                const skips = e.event === "dispatch_tick" ? tickSkips(e.data) : [];
                const name = who(line.contactId);
                return (
                  <li key={e.id} className="flex gap-2 border-b border-[#f1f5f9] px-3 py-2 text-[12px] last:border-b-0">
                    <time dateTime={e.at} className="shrink-0 font-mono text-[11px] tabular-nums text-[#94a3b8]" dir="ltr">
                      {timeFmt.format(new Date(e.at))}
                    </time>
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[line.tone]}`} aria-hidden />
                    <span className="min-w-0 text-[#334155]">
                      {name && (
                        <bdi className="font-semibold text-[#18181b]">{name}</bdi>
                      )}
                      {name && " · "}
                      {t(`ev.${line.key}`, {
                        ...line.params,
                        ...(typeof line.params.outcome === "string"
                          ? { outcome: t(`outcome_${line.params.outcome}`) }
                          : {}),
                      })}
                      {skips.length > 0 && (
                        <span className="text-[#64748b]">
                          {" · "}
                          {t("ev.skipped", {
                            reasons: skips.map(([r]) => t(`skip_${r}`)).join(", "),
                          })}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────

type T = ReturnType<typeof useTranslations<"DashboardCampaigns.live">>;

const TONE_DOT = {
  info: "bg-[#94a3b8]",
  good: "bg-[#16a34a]",
  warn: "bg-[#f59e0b]",
  bad: "bg-[#dc2626]",
} as const;

function ConsoleTitle({ t, live }: { t: T; live: boolean }) {
  return (
    <h4 className="flex items-center gap-2 text-[14px] font-bold text-[#18181b]">
      <span className="relative flex h-2.5 w-2.5" aria-hidden>
        {live && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-[#22c55e] opacity-60 motion-safe:animate-ping" />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${live ? "bg-[#16a34a]" : "bg-[#94a3b8]"}`} />
      </span>
      {t("title")}
    </h4>
  );
}

function Chip({ tone, children }: { tone: "good" | "warn" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "good"
      ? "bg-[#f0fdf4] text-[#166534] ring-[#bbf7d0]"
      : tone === "warn"
        ? "bg-[#fffbeb] text-[#92400e] ring-[#fde68a]"
        : "bg-[#f1f5f9] text-[#334155] ring-[#e2e8f0]";
  return <span className={`rounded-full px-3 py-1 text-[12px] font-medium ring-1 ${cls}`}>{children}</span>;
}

const COUNTER_TONE = {
  slate: "text-[#334155]",
  cyan: "text-[#0e7490]",
  green: "text-[#15803d]",
  rose: "text-[#be123c]",
} as const;

function Counter({
  label,
  value,
  tone,
  pulse,
}: {
  label: string;
  value: number;
  tone: keyof typeof COUNTER_TONE;
  pulse?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2.5">
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
        {pulse && <span className="h-1.5 w-1.5 rounded-full bg-[#06b6d4] motion-safe:animate-pulse" aria-hidden />}
        {label}
      </dt>
      <dd className={`mt-0.5 text-2xl font-bold tabular-nums ${COUNTER_TONE[tone]}`}>{value}</dd>
    </div>
  );
}

const STATE_PILL: Record<string, string> = {
  claimed: "bg-[#f1f5f9] text-[#475569]",
  dialing: "bg-[#ecfeff] text-[#0e7490]",
  ringing: "bg-[#fef3c7] text-[#92400e]",
  in_call: "bg-[#dcfce7] text-[#166534]",
  completed: "bg-[#dcfce7] text-[#166534]",
  queued: "bg-[#f1f5f9] text-[#475569]",
  retry: "bg-[#f1f5f9] text-[#475569]",
};

function ContactRow({
  c,
  now,
  t,
  shortFmt,
  highlight,
}: {
  c: LiveContact;
  now: Date;
  t: T;
  shortFmt: Intl.DateTimeFormat;
  highlight?: boolean;
}) {
  const v = contactView(c, now);
  let pillKey: string;
  let pill: string;
  if (v.kind === "live") {
    pillKey = v.state;
    pill =
      v.state === "in_call"
        ? t("stateInCall", { duration: formatElapsed(v.seconds) })
        : v.state === "ringing"
          ? t("stateRinging", { duration: formatElapsed(v.seconds) })
          : t(`state_${v.state}`);
  } else if (v.kind === "retry") {
    pillKey = "retry";
    pill = t("retryAt", { at: shortFmt.format(new Date(v.at)) });
  } else if (v.kind === "queued") {
    pillKey = "queued";
    pill = t("state_queued");
  } else {
    pillKey = v.outcome;
    pill = t(`outcome_${v.outcome}`);
  }
  const pillCls = STATE_PILL[pillKey] ?? "bg-[#ffe4e6] text-[#9f1239]";

  return (
    <li
      className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 ${
        highlight ? "border border-[#a5f3fc] bg-[#ecfeff]/50" : "bg-[#f8fafc]"
      }`}
    >
      <div className="min-w-0">
        {c.name && <p className="truncate text-[12px] font-semibold text-[#18181b]">{c.name}</p>}
        <p className="font-mono text-[11px] tabular-nums text-[#475569]" dir="ltr">
          {c.phoneNumber}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {c.attempts > 1 && (
          <span className="text-[11px] text-[#94a3b8]">{t("attempt", { n: c.attempts })}</span>
        )}
        <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums ${pillCls}`}>
          {pill}
        </span>
      </div>
    </li>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
      <path d="M7 4v16l13-8z" />
    </svg>
  );
}
