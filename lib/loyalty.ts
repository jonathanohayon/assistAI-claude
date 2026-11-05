// Client loyalty v1 = count only. Pure helpers (no DB): Calendar event →
// visit row, and visit rows → client profile. "Regular" from 3 past visits
// (salons are roughly monthly).

import { normalizeClientPhone, parseEventContact } from "@/lib/reminders";

export const REGULAR_MIN_VISITS = 3;

/** Minimal shape of a Google Calendar event we read. */
export interface CalendarEventLike {
  id?: string | null;
  status?: string | null; // "confirmed" | "tentative" | "cancelled"
  summary?: string | null;
  description?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
}

export type VisitChange =
  | { kind: "upsert"; eventId: string; clientPhone: string; clientName: string; startsAt: Date }
  | { kind: "cancel"; eventId: string };

/**
 * What a Calendar event means for loyalty. Deleted/cancelled events (which
 * Google returns with only id + status when showDeleted) → cancel. Events
 * without a parsable client phone or start → null (not a client booking).
 */
export function visitChangeFromEvent(ev: CalendarEventLike): VisitChange | null {
  const eventId = ev.id ?? "";
  if (!eventId) return null;
  if (ev.status === "cancelled") return { kind: "cancel", eventId };
  const startRaw = ev.start?.dateTime ?? ev.start?.date ?? "";
  const startsAt = new Date(startRaw);
  if (!startRaw || Number.isNaN(startsAt.getTime())) return null;
  const { name, phone } = parseEventContact(ev);
  if (!phone) return null;
  return { kind: "upsert", eventId, clientPhone: phone, clientName: name, startsAt };
}

export interface VisitRowLike {
  clientName: string;
  startsAt: Date;
  cancelled: boolean;
}

export interface ClientProfile {
  visits: number; // past, not cancelled
  lastVisitAt: string | null;
  nextVisitAt: string | null; // next booked (future, not cancelled)
  regular: boolean;
  name: string; // latest non-empty name on a booking
}

export function buildClientProfile(rows: VisitRowLike[], now: Date): ClientProfile | null {
  const live = rows.filter((r) => !r.cancelled);
  if (live.length === 0) return null;
  const past = live.filter((r) => r.startsAt <= now).sort((a, b) => +b.startsAt - +a.startsAt);
  const future = live.filter((r) => r.startsAt > now).sort((a, b) => +a.startsAt - +b.startsAt);
  const byRecency = [...live].sort((a, b) => +b.startsAt - +a.startsAt);
  return {
    visits: past.length,
    lastVisitAt: past[0]?.startsAt.toISOString() ?? null,
    nextVisitAt: future[0]?.startsAt.toISOString() ?? null,
    regular: past.length >= REGULAR_MIN_VISITS,
    name: byRecency.find((r) => r.clientName)?.clientName ?? "",
  };
}

/** Caller number from the worker → E.164 key used in client_visits. */
export function clientPhoneKey(raw: string | null | undefined): string | null {
  return raw ? normalizeClientPhone(raw) : null;
}
