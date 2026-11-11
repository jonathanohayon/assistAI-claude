"use client";

/**
 * Tenant Calls view (J2, levels 1 and 2): the period's three figures, one
 * line per inbound call, and an inline detail under the tapped line (summary,
 * what was done, the conversation, then "More details"). Default content of
 * the Monitoring page, above the engineering console. Data: GET
 * /api/dashboard/calls (+ /[id]), shapes in lib/calls/contract.ts; words and
 * formats in lib/calls/view.ts. Admins pass asUserId, like LogsView.
 */

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { MoreSettings } from "@/components/bricks/MoreSettings";
import { TranscriptBubbles } from "@/components/calls/TranscriptBubbles";
import type {
  CallDetailResponse,
  CallFigures,
  CallLine,
  CallListResponse,
  CallOutcome,
  CallPeriod,
} from "@/lib/calls/contract";
import {
  actionMessage,
  calledNumber,
  contactLabel,
  conversationView,
  detailUrl,
  durationMessage,
  formatCallTime,
  listUrl,
  outcomeKey,
  type Msg,
} from "@/lib/calls/view";

import { Stat } from "../config/shared-ui";

type T = ReturnType<typeof useTranslations<"Calls">>;
// Keys are built by lib/calls/view.ts; the tests check they all exist.
const say = (t: T, m: Msg) => (t as unknown as (k: string, v?: Msg["values"]) => string)(m.key, m.values);

const OUTCOME_TONE: Record<CallOutcome, string> = {
  booked: "bg-[#ccfbf1] text-[#115e59]",
  cancelled: "bg-[#fee2e2] text-[#991b1b]",
  rescheduled: "bg-[#fef3c7] text-[#92400e]",
  transferred: "bg-[#cffafe] text-[#155e75]",
  conversation: "bg-[#f1f5f9] text-[#475569]",
};

type DetailState = { status: "loading" } | { status: "error" } | { status: "ready"; data: CallDetailResponse };

export function CallsView({
  asUserId,
  headingLevel = 2,
}: {
  asUserId?: string;
  /** 1 when the view opens the page (tenant Monitoring page). */
  headingLevel?: 1 | 2;
} = {}) {
  const t = useTranslations("Calls");
  const locale = useLocale();

  const [items, setItems] = useState<CallLine[]>([]);
  const [figures, setFigures] = useState<CallFigures | null>(null);
  const [period, setPeriod] = useState<CallPeriod | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [moreStatus, setMoreStatus] = useState<"idle" | "loading" | "error">("idle");
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, DetailState>>({});

  const fetchPage = useCallback(
    async (cursor: string | null): Promise<CallListResponse> => {
      const res = await fetch(listUrl(cursor, asUserId), { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as CallListResponse;
    },
    [asUserId],
  );

  const showFirst = (page: CallListResponse) => {
    setItems(page.items);
    setFigures(page.figures);
    setPeriod(page.period);
    setNextCursor(page.nextCursor);
    setStatus("ready");
  };

  // Status starts at "loading"; a retry sets it back before calling this.
  const loadFirst = () =>
    fetchPage(null).then(showFirst, () => setStatus("error"));

  useEffect(() => {
    let alive = true;
    fetchPage(null).then(
      (page) => {
        if (!alive) return;
        setItems(page.items);
        setFigures(page.figures);
        setPeriod(page.period);
        setNextCursor(page.nextCursor);
        setStatus("ready");
      },
      () => {
        if (alive) setStatus("error");
      },
    );
    return () => {
      alive = false;
    };
  }, [fetchPage]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setMoreStatus("loading");
    try {
      const page = await fetchPage(nextCursor);
      setItems((prev) => [...prev, ...page.items.filter((x) => !prev.some((p) => p.id === x.id))]);
      setNextCursor(page.nextCursor);
      setMoreStatus("idle");
    } catch {
      setMoreStatus("error");
    }
  };

  const loadDetail = async (id: string) => {
    setDetails((d) => ({ ...d, [id]: { status: "loading" } }));
    try {
      const res = await fetch(detailUrl(id, asUserId), { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as CallDetailResponse;
      setDetails((d) => ({ ...d, [id]: { status: "ready", data } }));
    } catch {
      setDetails((d) => ({ ...d, [id]: { status: "error" } }));
    }
  };

  const toggle = (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    const d = details[id];
    if (!d || d.status === "error") void loadDetail(id);
  };

  const Title = headingLevel === 1 ? "h1" : "h2";
  const dayFmt = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : locale === "en" ? "en-US" : "fr-FR", {
    day: "numeric",
    month: "long",
  });

  return (
    <section aria-labelledby="calls-title" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Title id="calls-title" className="font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
          {t("title")}
        </Title>
        {period && (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {t("periodRange", {
              since: dayFmt.format(new Date(period.since)),
              until: dayFmt.format(new Date(period.until)),
            })}
          </p>
        )}
      </div>

      {status === "loading" && (
        <p role="status" className="rounded-2xl border border-[var(--color-border)] bg-white p-6 text-sm text-[var(--color-muted-foreground)]">
          {t("loading")}
        </p>
      )}

      {status === "error" && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-white p-6">
          <p className="text-sm text-[var(--color-foreground)]">{t("loadError")}</p>
          <button
            type="button"
            onClick={() => {
              setStatus("loading");
              void loadFirst();
            }}
            className="min-h-11 rounded-full border border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--color-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2"
          >
            {t("retry")}
          </button>
        </div>
      )}

      {status === "ready" && figures && (
        <div
          role="group"
          aria-label={t("figuresLabel")}
          className="grid grid-cols-3 gap-3 rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm sm:gap-6 sm:p-6"
        >
          <Stat label={t("figureCallsReceived")} value={t("figureValue", { count: figures.callsReceived })} tone="cyan" />
          <Stat label={t("figureBooked")} value={t("figureValue", { count: figures.booked })} tone="primary" />
          <Stat label={t("figureTransferred")} value={t("figureValue", { count: figures.transferred })} tone="teal" />
        </div>
      )}

      {status === "ready" && items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-white p-8 text-center">
          <p className="font-medium text-[var(--color-foreground)]">{t("emptyTitle")}</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-muted-foreground)]">{t("emptyBody")}</p>
        </div>
      )}

      {status === "ready" && items.length > 0 && (
        <ul aria-label={t("listLabel")} className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
          {items.map((line) => (
            <CallRow
              key={line.id}
              line={line}
              open={openId === line.id}
              onToggle={() => toggle(line.id)}
              detail={details[line.id]}
              onRetry={() => void loadDetail(line.id)}
              t={t}
              locale={locale}
            />
          ))}
        </ul>
      )}

      {status === "ready" && (
        <LoadMore nextCursor={nextCursor} status={moreStatus} onMore={() => void loadMore()} t={t} />
      )}
    </section>
  );
}

/** "Show more": present only while the API returns a next cursor (no infinite scroll). */
export function LoadMore({
  nextCursor,
  status,
  onMore,
  t,
}: {
  nextCursor: string | null;
  status: "idle" | "loading" | "error";
  onMore: () => void;
  t: T;
}) {
  if (!nextCursor) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onMore}
        disabled={status === "loading"}
        className="min-h-11 rounded-full border border-[var(--color-border)] bg-white px-6 text-sm font-medium text-[var(--color-foreground)] shadow-sm hover:bg-[var(--color-muted)] disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2"
      >
        {status === "loading" ? t("loading") : t("loadMore")}
      </button>
      {status === "error" && (
        <p role="alert" className="text-sm text-[#991b1b]">
          {t("loadError")}
        </p>
      )}
    </div>
  );
}

export function CallRow({
  line,
  open,
  onToggle,
  detail,
  onRetry,
  t,
  locale,
  now,
}: {
  line: CallLine;
  open: boolean;
  onToggle: () => void;
  detail?: DetailState;
  onRetry: () => void;
  t: T;
  locale: string;
  /** For tests: the reference "today". */
  now?: Date;
}) {
  const who = contactLabel(line);
  const duration = durationMessage(line.durationSeconds);
  const panelId = `call-${line.id}`;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-[#f8fafc] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0e7490]"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[var(--color-foreground)]">
            {who.kind === "hidden" ? t(who.key) : who.kind === "number" ? <bdi dir="ltr">{who.text}</bdi> : who.text}
          </span>
          <span className="mt-0.5 block text-xs text-[var(--color-muted-foreground)]">
            {formatCallTime(line.createdAt, locale, now)}
            {duration && (
              <>
                {" · "}
                {say(t, duration)}
              </>
            )}
          </span>
        </span>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${OUTCOME_TONE[line.outcome] ?? OUTCOME_TONE.conversation}`}>
          {say(t, { key: outcomeKey(line.outcome) })}
        </span>
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 shrink-0 text-[var(--color-muted-foreground)] transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div id={panelId} hidden={!open} className="border-t border-[var(--color-border)] bg-[#fcfcfd] px-4 py-4">
        {open && <CallDetailBody line={line} detail={detail} onRetry={onRetry} t={t} locale={locale} />}
      </div>
    </li>
  );
}

export function CallDetailBody({
  line,
  detail,
  onRetry,
  t,
  locale,
  moreOpen,
}: {
  line: CallLine;
  detail?: DetailState;
  onRetry: () => void;
  t: T;
  locale: string;
  /** For tests / shots: render "More details" open. */
  moreOpen?: boolean;
}) {
  if (!detail || detail.status === "loading") {
    return (
      <p role="status" className="text-sm text-[var(--color-muted-foreground)]">
        {t("detailLoading")}
      </p>
    );
  }
  if (detail.status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-[var(--color-foreground)]">{t("detailError")}</p>
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 rounded-full border border-[var(--color-border)] px-4 text-sm font-medium hover:bg-[var(--color-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490]"
        >
          {t("retry")}
        </button>
      </div>
    );
  }
  const d = detail.data;
  // The list line may be older than the detail; the detail wins when present.
  const merged: CallLine = { ...line, ...d };
  const conv = conversationView(d);
  const toNumber = calledNumber(merged);
  const duration = durationMessage(merged.durationSeconds);
  const heading = "text-xs font-semibold uppercase tracking-wider text-[#475569]";

  return (
    <div className="space-y-5">
      <div>
        <h3 className={heading}>{t("summaryTitle")}</h3>
        {d.hasSummary && d.summary ? (
          <p dir={d.direction} className="mt-1.5 text-start text-sm leading-relaxed text-[var(--color-foreground)]">
            {d.summary}
          </p>
        ) : (
          <p className="mt-1.5 text-sm italic text-[var(--color-muted-foreground)]">{t("summaryPending")}</p>
        )}
      </div>

      <div>
        <h3 className={heading}>{t("doneTitle")}</h3>
        {d.actions.length === 0 ? (
          <p className="mt-1.5 text-sm text-[var(--color-muted-foreground)]">{t("doneNothing")}</p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {d.actions.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-foreground)]">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0e7490]" />
                <span>{say(t, actionMessage(a, locale))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className={heading}>{t("conversationTitle")}</h3>
        <div className="mt-2">
          {conv.kind === "bubbles" && (
            <TranscriptBubbles
              dir={d.direction}
              textSize="text-sm"
              speakers={{ agent: t("speakerAgent"), caller: t("speakerCaller") }}
              turns={d.transcript.map((m) => ({ fromAgent: m.role === "agent", text: m.text }))}
            />
          )}
          {conv.kind === "raw" && (
            <div data-transcript-raw>
              <p className="text-sm text-[var(--color-muted-foreground)]">{t("rawTranscriptNote")}</p>
              <pre dir="auto" className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[#f1f5f9] p-3 text-xs text-[#334155]">
                {conv.text}
              </pre>
            </div>
          )}
          {conv.kind === "none" && <p className="text-sm text-[var(--color-muted-foreground)]">{t("noTranscript")}</p>}
        </div>
      </div>

      {(toNumber || duration) && (
        <MoreSettings title={t("moreDetails")} defaultOpen={moreOpen}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            {toNumber && (
              <>
                <dt className="text-[var(--color-muted-foreground)]">{t("calledNumber")}</dt>
                <dd data-called-number>
                  <bdi dir="ltr">{toNumber}</bdi>
                </dd>
              </>
            )}
            {duration && (
              <>
                <dt className="text-[var(--color-muted-foreground)]">{t("duration")}</dt>
                <dd data-duration>{say(t, duration)}</dd>
              </>
            )}
          </dl>
        </MoreSettings>
      )}
    </div>
  );
}
