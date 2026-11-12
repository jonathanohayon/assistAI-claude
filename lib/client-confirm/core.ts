// Client WhatsApp confirm after a call — pure part (no DB, no network).
//
// The caller's number on a phone call is the SIP caller ID, which can be
// spoofed. So the caller gets a WhatsApp ONLY when the call PROVES something
// happened: a book_success / cancel_success / reschedule_success tool event
// joined to this call (lib/calls/core.ts THE JOIN RULE). The text states that
// event, built from the event's own metadata (date, time, place), never from
// the model's recap of what the caller said. A call that proves nothing sends
// nothing to the caller.
//
// Several proven events in one call: the LAST one decides (it is the state
// the appointment is left in: booked then moved → "moved to …").

import { createHash } from "node:crypto";

import type { JoinEvent } from "@/lib/calls/core";
import { formatDateLabel, type ReminderLang } from "@/lib/reminders";
import { signClientMessage } from "@/lib/summarize";
import { withCallUsLine } from "@/lib/whatsapp-call-line";

import fr from "@/messages/fr.json";
import he from "@/messages/he.json";
import en from "@/messages/en.json";

export const PROVEN_EVENTS = ["book_success", "cancel_success", "reschedule_success"] as const;

/** Per destination number: at most this many confirms per window. */
export const CLIENT_CONFIRM_PER_NUMBER = 3;
/** Ceiling across all numbers per window (each bucket ledger stays bounded). */
export const CLIENT_CONFIRM_DAILY_CEILING = 1000;
export const CLIENT_CONFIRM_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Rate-limit buckets (lib/rate-limit-db.ts). */
export const CLIENT_CONFIRM_BUCKET = "client_confirm";
export const CLIENT_CONFIRM_CALL_BUCKET = "client_confirm_call";

export type ConfirmKind = "booked" | "cancelled" | "rescheduled";

export interface ProvenEvent {
  kind: ConfirmKind;
  /** YYYY-MM-DD, or null (a cancel whose appointment is unknown). */
  date: string | null;
  /** HH:MM, or null. */
  time: string | null;
  place: string | null;
  /** cancel_success only: the calendar event cancelled (to look up its date). */
  eventId: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const PLACE_MAX = 80;

const str = (v: unknown, re: RegExp): string | null => (typeof v === "string" && re.test(v) ? v : null);

/** Place label of a tool event: metadata.location (current) or .center (legacy). */
export function placeOf(m: Record<string, unknown>): string | null {
  for (const k of ["location", "center"]) {
    const v = m[k];
    if (typeof v !== "string") continue;
    const clean = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (clean) return clean.slice(0, PLACE_MAX);
  }
  return null;
}

function provenOf(e: Pick<JoinEvent, "event" | "metadata">): ProvenEvent | null {
  const m = e.metadata ?? {};
  switch (e.event) {
    case "book_success": {
      const date = str(m["date"], DATE_RE);
      const time = str(m["time"], TIME_RE);
      return date && time ? { kind: "booked", date, time, place: placeOf(m), eventId: null } : null;
    }
    case "reschedule_success": {
      const date = str(m["newDate"], DATE_RE);
      const time = str(m["newTime"], TIME_RE);
      return date && time ? { kind: "rescheduled", date, time, place: placeOf(m), eventId: null } : null;
    }
    case "cancel_success": {
      const id = m["eventId"];
      return { kind: "cancelled", date: null, time: null, place: null, eventId: typeof id === "string" && id ? id : null };
    }
    default:
      return null;
  }
}

/**
 * The call's proven event: the LAST (createdAt) usable book / cancel /
 * reschedule success, or null. A book/reschedule without a valid date and
 * time is not usable (its text could not state it).
 */
export function lastProvenEvent(events: Array<Pick<JoinEvent, "event" | "metadata" | "createdAt">>): ProvenEvent | null {
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = provenOf(sorted[i]);
    if (p) return p;
  }
  return null;
}

/** The appointment a cancel_success cancelled, from that event's last book/reschedule. */
export function appointmentFromEvent(e: Pick<JoinEvent, "event" | "metadata"> | null): Pick<ProvenEvent, "date" | "time" | "place"> | null {
  if (!e) return null;
  const p = provenOf(e);
  return p && p.kind !== "cancelled" ? { date: p.date, time: p.time, place: p.place } : null;
}

type Lang = ReminderLang;
type Strings = { booked: string; cancelled: string; cancelledNoDate: string; rescheduled: string; place: string };
const STRINGS: Record<Lang, Strings> = { fr: fr.ClientConfirm, he: he.ClientConfirm, en: en.ClientConfirm };

export function confirmLang(lang: string | null | undefined): Lang {
  return lang === "he" || lang === "en" ? lang : "fr";
}

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

/** The event sentence (+ place line), in the tenant's language. No signature, no call line. */
export function confirmSentence(p: ProvenEvent, lang: string | null | undefined): string {
  const l = confirmLang(lang);
  const t = STRINGS[l];
  const dated = p.date && p.time;
  const vars: Record<string, string> = dated ? { date: formatDateLabel(p.date!, l), time: p.time! } : {};
  const key = p.kind === "cancelled" && !dated ? "cancelledNoDate" : p.kind;
  const lines = [fill(t[key], vars)];
  if (p.place) lines.push(fill(t.place, { place: p.place }));
  return lines.join("\n");
}

/**
 * The whole client text: event sentence, the tenant's own business-name
 * signature (summarySignature; '' = none), then the "call us" line inside the
 * 1000-char template variable (withCallUsLine).
 */
export function clientConfirmText(
  p: ProvenEvent,
  opts: { lang: string | null | undefined; signature: string; callNumber: string | null | undefined },
): string {
  const lang = confirmLang(opts.lang);
  return withCallUsLine(signClientMessage(confirmSentence(p, lang), opts.signature), lang, opts.callNumber);
}

/** Rate-limit account id of a destination: sha256 of its E.164, never the number. */
export function destinationKey(e164: string): string {
  return createHash("sha256").update(e164, "utf8").digest("hex");
}

/** Rate-limit account id of (call, destination): one confirm per destination per call. */
export function callDestinationKey(callKey: string, e164: string): string {
  return createHash("sha256").update(`${callKey}\n${e164}`, "utf8").digest("hex");
}

/** Provider error text with any phone-number-like run masked (logs carry no number). */
export function redactNumbers(s: string | null | undefined): string {
  return (s ?? "").replace(/\+?\d[\d\s().-]{5,}\d/g, "[number]");
}
