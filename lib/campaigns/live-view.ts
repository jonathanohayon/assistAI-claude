// Live campaign console: client-side view helpers over the admin live feed
// (GET /api/dashboard/campaigns/:id/live, see lib/campaigns/live.ts).
// Client-safe and pure. Unit-tested in scripts/tests/campaign-live-view.test.ts.

import type { DispatchMode } from "./dispatch-mode";
import type { BlockReason, DispatchTick } from "./live";

export interface LiveContact {
  contactId: string;
  phoneNumber: string;
  name: string;
  status: string;
  callState: "" | "dialing" | "ringing" | "in_call" | "ended";
  callStateAt: string | null;
  attempts: number;
  nextAttemptAt: string | null;
}

export interface LiveEvent {
  id: string;
  at: string;
  event: string;
  level: string;
  message: string;
  contactId: string | null;
  data: Record<string, unknown> | null;
}

export interface LiveFeed {
  now: string;
  campaign: {
    id: string;
    name: string;
    status: string;
    concurrency: number;
    fromNumber: string;
    startedAt: string | null;
    callWindow: { timezone: string; days: number[]; startHour: number; endHour: number };
    inCallWindow: boolean;
  };
  counts: Partial<Record<string, number>>;
  dispatcher: {
    lastTick: DispatchTick | null;
    blockers: BlockReason[];
    inFlight: number;
    dueQueued: number;
    /** Platform call switch: "off" = no calls placed, "dry" = test mode (a viewer-safe word, never the env). */
    dispatchMode: DispatchMode;
  };
  inProgress: LiveContact[];
  contacts: LiveContact[];
  contactsTotal: number;
  events: LiveEvent[];
}

/** The four console counters. Missing status keys count as 0. */
export function counterBuckets(counts: Partial<Record<string, number>>) {
  const n = (k: string) => counts[k] ?? 0;
  return {
    queued: n("queued"),
    calling: n("claimed") + n("calling"),
    done: n("completed"),
    failed: n("failed") + n("no_answer") + n("voicemail") + n("busy") + n("skipped"),
  };
}

/**
 * Merges an incremental events page (`?since=`) into what the console
 * already shows: dedupe by id, newest first, capped.
 */
export function mergeEvents(prev: LiveEvent[], incoming: LiveEvent[], cap = 200): LiveEvent[] {
  const byId = new Map<string, LiveEvent>();
  for (const e of [...incoming, ...prev]) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : -1))
    .slice(0, cap);
}

/** `since` for the next poll: the newest event shown, or null for a full page. */
export function nextSince(events: LiveEvent[]): string | null {
  return events[0]?.at ?? null;
}

export type ContactView =
  | { kind: "live"; state: "claimed" | "dialing" | "ringing" | "in_call"; seconds: number }
  | { kind: "retry"; at: string }
  | { kind: "queued" }
  | { kind: "outcome"; outcome: string };

/** What a contact row shows, per the feed's display rules. */
export function contactView(c: LiveContact, now: Date): ContactView {
  const since = (iso: string | null) =>
    iso ? Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 1000)) : 0;
  if (c.status === "claimed") return { kind: "live", state: "claimed", seconds: 0 };
  if (c.status === "calling") {
    const state = c.callState === "" || c.callState === "ended" ? "dialing" : c.callState;
    return { kind: "live", state, seconds: since(c.callStateAt) };
  }
  if (c.status === "queued") {
    if (c.nextAttemptAt && Date.parse(c.nextAttemptAt) > now.getTime())
      return { kind: "retry", at: c.nextAttemptAt };
    return { kind: "queued" };
  }
  return { kind: "outcome", outcome: c.status };
}

/** "m:ss" (or "h:mm:ss") for call durations. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Skip reasons of a dispatch_tick event, counted: [["outside_call_window", 2]]. */
export function tickSkips(data: Record<string, unknown> | null): Array<[string, number]> {
  const raw = data?.skipped;
  if (!Array.isArray(raw)) return [];
  const counts = new Map<string, number>();
  for (const r of raw) {
    const reason =
      typeof r === "string"
        ? r
        : r && typeof r === "object" && typeof (r as { reason?: unknown }).reason === "string"
          ? (r as { reason: string }).reason
          : null;
    if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()];
}

export type EventLine = {
  /** i18n key under DashboardCampaigns.live.ev */
  key: string;
  params: Record<string, string | number>;
  /** Contact this line is about (resolved to a name/number by the caller). */
  contactId: string | null;
  tone: "info" | "good" | "warn" | "bad";
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Maps a feed event to a localisable line. Unknown events fall back to the
 * server's own message (key "raw").
 */
export function eventLine(e: LiveEvent): EventLine {
  const d = e.data ?? {};
  const contactId = e.contactId;
  switch (e.event) {
    case "dispatch_tick": {
      const dialed = num(d.dialed);
      return {
        key: dialed > 0 ? "tickDialed" : "tickIdle",
        params: { claimed: num(d.claimed), dialed, failed: num(d.failed) },
        contactId: null,
        tone: num(d.failed) > 0 ? "bad" : dialed > 0 ? "good" : "info",
      };
    }
    case "campaign_dial":
      return { key: "dial", params: { attempt: num(d.attempt) || 1 }, contactId, tone: "info" };
    case "campaign_dial_failed":
      return { key: "dialFailed", params: {}, contactId, tone: "bad" };
    case "campaign_call_progress": {
      const state = typeof d.state === "string" ? d.state : "";
      if (state === "ended")
        return { key: "progressEnded", params: { duration: formatElapsed(num(d.durationSeconds)) }, contactId, tone: "info" };
      if (state === "ringing" || state === "in_call" || state === "dialing")
        return { key: `progress_${state}`, params: {}, contactId, tone: state === "in_call" ? "good" : "info" };
      break;
    }
    case "campaign_call_done": {
      const outcome = typeof d.outcome === "string" ? d.outcome : "failed";
      const retry = d.retry && typeof d.retry === "object" ? num((d.retry as { inMinutes?: unknown }).inMinutes) : 0;
      return {
        key: retry > 0 ? "doneRetry" : "done",
        // timed = "yes" only when the call actually lasted (no "(0:00)" on a busy line).
        params: {
          outcome,
          duration: formatElapsed(num(d.durationSeconds)),
          timed: num(d.durationSeconds) > 0 ? "yes" : "no",
          minutes: retry,
        },
        contactId,
        tone: outcome === "connected" ? "good" : outcome === "failed" ? "bad" : "warn",
      };
    }
    case "campaign_start":
    case "campaign_pause":
    case "campaign_complete":
    case "campaign_archive":
      return { key: e.event.replace("campaign_", "status_"), params: {}, contactId: null, tone: "info" };
  }
  return { key: "raw", params: { message: e.message }, contactId, tone: e.level === "error" ? "bad" : "info" };
}

// ── Start / pause feedback (never a silent no-op) ─────────────────────

export type { DispatchMode };

/** The plain line under the controls when calls aren't really placed; null when they are. */
export function dispatchNoticeKey(mode: unknown): "dispatchOff" | "dispatchDry" | null {
  return mode === "off" ? "dispatchOff" : mode === "dry" ? "dispatchDry" : null;
}

export type ActionErrorKey = "session" | "forbidden" | "notFound" | "changed" | "unknown";

/**
 * A refused start / pause in plain words: the server's code first, the HTTP
 * status as a fallback, a generic line for anything else (500, network).
 */
export function actionErrorKey(status: number | null, body: unknown): ActionErrorKey {
  const code = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (code === "invalid_transition" || status === 409) return "changed";
  if (code === "not_found" || status === 404) return "notFound";
  if (code === "Forbidden" || status === 403) return "forbidden";
  if (code === "Unauthorized" || status === 401) return "session";
  return "unknown";
}

// ── Platform call switch: ONE table for every place that shows it ─────

export type ModeTone = "good" | "warn";

/**
 * How each platform call-switch mode reads on screen. The console pill and
 * the launch panel heading both read this table (through `readyPill` and
 * `launchHeading`), so they can never disagree. `pill` keys live under
 * DashboardCampaigns.live, `launch` keys under DashboardCampaigns.
 */
export const MODE_VIEW = {
  on: { tone: "good", pill: "readyToDial", launch: "launchTitle" },
  off: { tone: "warn", pill: "dispatchPausedPill", launch: "launchPausedTitle" },
  dry: { tone: "warn", pill: "dispatchDryPill", launch: "launchDryTitle" },
} as const satisfies Record<DispatchMode, { tone: ModeTone; pill: string; launch: string }>;

/** The MODE_VIEW row for a mode; unknown (not loaded yet) reads as "on", today's behaviour. */
export function modeView(mode: unknown): (typeof MODE_VIEW)[DispatchMode] {
  return MODE_VIEW[mode === "off" || mode === "dry" ? mode : "on"];
}

/** Chip colours per tone, shared by the console chips and the launch heading. */
export const TONE_CHIP = {
  good: "bg-[#f0fdf4] text-[#166534] ring-[#bbf7d0]",
  warn: "bg-[#fffbeb] text-[#92400e] ring-[#fde68a]",
  info: "bg-[#f1f5f9] text-[#334155] ring-[#e2e8f0]",
} as const;

export type ReadyPill =
  | { key: "readyToDial"; tone: "good" }
  | { key: "dispatchPausedPill" | "dispatchDryPill"; tone: "warn" };

/**
 * The "no blockers" pill, kept consistent with the platform call switch:
 * green "ready" only when calls really go out, amber "paused" / "test mode"
 * otherwise. null while blockers exist (the blocker chips speak instead).
 */
export function readyPill(mode: unknown, blockers: readonly unknown[]): ReadyPill | null {
  if (blockers.length > 0) return null;
  const v = modeView(mode);
  return { key: v.pill, tone: v.tone } as ReadyPill;
}

export type LaunchHeading =
  | { key: "launchTitle"; tone: "good" }
  | { key: "launchPausedTitle" | "launchDryTitle"; tone: "warn" };

/**
 * The launch panel heading above the console: "ready to launch" only when
 * calls really go out, amber "paused on the platform" / "test mode" otherwise.
 * Never null: the panel always has a heading, blockers or not.
 */
export function launchHeading(mode: unknown): LaunchHeading {
  const v = modeView(mode);
  return { key: v.launch, tone: v.tone } as LaunchHeading;
}

/**
 * Whether the dispatcher health alerts (never ran / stale tick) may show.
 * Hidden while calls are switched off: the pause line already explains why
 * nothing dials. In test mode the dispatcher does run, so they stay.
 */
export function showDispatcherAlert(mode: unknown): boolean {
  return mode !== "off";
}
