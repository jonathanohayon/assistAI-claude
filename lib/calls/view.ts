// Tenant Calls page — pure view helpers (client-safe: no I/O, no node APIs).
// They turn the API's facts (lib/calls/contract.ts) into message keys of the
// `Calls` namespace + values, so the words live in messages/*.json and the
// tests can check every key exists in fr / en / he.

import type { CallAction, CallLine, CallOutcome } from "@/lib/calls/contract";
import { formatPhone } from "@/lib/format-phone";

/** A line as the front reads it: `toNumber` is optional until #278 sends it on every row. */
export type CallLineView = CallLine & { toNumber?: string };

/** A message of the `Calls` namespace with its ICU values. */
export interface Msg {
  key: string;
  values?: Record<string, string | number>;
}

export const OUTCOMES: readonly CallOutcome[] = ["booked", "cancelled", "rescheduled", "transferred", "conversation"];

/** Outcome → the message key of its words. Tool-proven only: the API decides the outcome. */
export function outcomeKey(outcome: CallOutcome): string {
  return `outcome_${OUTCOMES.includes(outcome) ? outcome : "conversation"}`;
}

const intlLocale = (locale: string) => (locale === "he" ? "he-IL" : locale === "en" ? "en-US" : "fr-FR");

/** "YYYY-MM-DD" (a calendar day, no time zone) → a long local date, e.g. "12 novembre". */
export function formatDay(day: string, locale: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

/** Action → the sentence that says what was done. Only whitelisted fields are used. */
export function actionMessage(action: CallAction, locale: string): Msg {
  switch (action.kind) {
    case "booked":
    case "rescheduled": {
      const base = action.kind === "booked" ? "action_booked" : "action_rescheduled";
      if (action.date && action.time) {
        return { key: `${base}_at`, values: { date: formatDay(action.date, locale), time: action.time } };
      }
      if (action.date) return { key: `${base}_on`, values: { date: formatDay(action.date, locale) } };
      return { key: base };
    }
    case "cancelled":
      return { key: "action_cancelled" };
    case "transferred":
      return { key: action.ok ? "action_transferred" : "action_transferFailed" };
    case "whatsapp_recap":
      return { key: `action_recap_${action.recipient}_${action.status}` };
  }
}

/** Every action key, for the tests (every kind × variant). */
export const ACTION_KEYS: readonly string[] = [
  "action_booked",
  "action_booked_on",
  "action_booked_at",
  "action_rescheduled",
  "action_rescheduled_on",
  "action_rescheduled_at",
  "action_cancelled",
  "action_transferred",
  "action_transferFailed",
  ...(["caller", "owner"] as const).flatMap((r) =>
    (["sent", "undelivered", "failed"] as const).map((s) => `action_recap_${r}_${s}`),
  ),
];

function sameLocalDay(a: Date, b: Date, timeZone?: string): boolean {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(a) === f.format(b);
}

/** When the call happened: today → time only; otherwise date + time. */
export function formatCallTime(iso: string, locale: string, now = new Date(), timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const loc = intlLocale(locale);
  const time = { hour: "2-digit", minute: "2-digit", timeZone } as const;
  if (sameLocalDay(d, now, timeZone)) return new Intl.DateTimeFormat(loc, time).format(d);
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(loc, {
    ...time,
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(d);
}

/**
 * Who called: the contact's name, else the number (to be rendered LTR-isolated),
 * else the hidden-number words.
 */
export type ContactLabel =
  | { kind: "name"; text: string }
  | { kind: "number"; text: string }
  | { kind: "hidden"; key: "hiddenNumber" };

export function contactLabel(line: Pick<CallLine, "contactName" | "fromNumber">): ContactLabel {
  const name = line.contactName?.trim();
  if (name) return { kind: "name", text: name };
  const num = line.fromNumber?.trim();
  if (num) return { kind: "number", text: formatPhone(num) };
  return { kind: "hidden", key: "hiddenNumber" };
}

/** Duration words, or null when the duration is unknown (never "0 s"). */
export function durationMessage(seconds: number | null | undefined): Msg | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const s = Math.round(seconds);
  const minutes = Math.floor(s / 60);
  const rest = s % 60;
  if (minutes === 0) return { key: "durationSeconds", values: { seconds: rest } };
  if (rest === 0) return { key: "durationMinutes", values: { minutes } };
  return { key: "durationMinutesSeconds", values: { minutes, seconds: rest } };
}

/** The number that was called, formatted, or null when absent / empty. */
export function calledNumber(line: CallLineView): string | null {
  const n = line.toNumber?.trim();
  return n ? formatPhone(n) : null;
}

/**
 * URL of a page of the list. The first page carries no cursor (default period);
 * the next pages carry ONLY the cursor (it holds the period), plus asUserId.
 */
export function listUrl(cursor: string | null, asUserId?: string): string {
  const p = new URLSearchParams();
  if (cursor) p.set("cursor", cursor);
  if (asUserId) p.set("asUserId", asUserId);
  const qs = p.toString();
  return `/api/dashboard/calls${qs ? `?${qs}` : ""}`;
}

export function detailUrl(id: string, asUserId?: string): string {
  const qs = asUserId ? `?${new URLSearchParams({ asUserId })}` : "";
  return `/api/dashboard/calls/${encodeURIComponent(id)}${qs}`;
}

/** What the conversation block shows: bubbles, the raw fallback, or nothing to show. */
export type ConversationView =
  | { kind: "bubbles" }
  | { kind: "raw"; text: string }
  | { kind: "none" };

export function conversationView(d: { transcript: unknown[]; transcriptRaw: string | null }): ConversationView {
  if (d.transcript.length > 0) return { kind: "bubbles" };
  if (d.transcriptRaw && d.transcriptRaw.trim()) return { kind: "raw", text: d.transcriptRaw };
  return { kind: "none" };
}
