"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { JERUSALEM_TZ } from "@/lib/tz";

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  description: string;
  link: string;
}

interface EditState {
  summary: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  description: string;
}

// Split an ISO datetime into local date + time strings (YYYY-MM-DD, HH:MM).
const splitIso = (iso: string): { date: string; time: string } => {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const tzOffset = d.getTimezoneOffset() * 60_000;
  const local = new Date(d.getTime() - tzOffset);
  const [date, timeWithMs] = local.toISOString().split("T");
  return { date, time: timeWithMs.slice(0, 5) };
};

const ALL_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function CalendarTable({
  initialEvents,
  asUserId,
  timeZone = JERUSALEM_TZ,
}: {
  initialEvents: CalendarEvent[];
  /** Tenant timezone used for every displayed date (server and client alike). */
  timeZone?: string;
  /** Admin agissant sur un tenant cible — propagé aux APIs /api/dashboard/calendar. */
  asUserId?: string;
}) {
  const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
  const t = useTranslations("DashboardCalendar");
  const locale = useLocale();
  const dateLocale = locale === "he" ? "he-IL" : locale === "en" ? "en-US" : "fr-FR";

  // Every date is formatted in the tenant's timezone, never the runtime's:
  // this component renders on the server (UTC) and hydrates in the browser
  // (local time), and any runtime-dependent output is a hydration mismatch.
  const timeFmt = new Intl.DateTimeFormat(dateLocale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateTimeFmt = new Intl.DateTimeFormat(dateLocale, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  // All-day events carry a bare calendar date ("2026-11-01"). It is a day,
  // not an instant, so it is formatted in UTC to stay on that same day.
  const dayFmt = new Intl.DateTimeFormat(dateLocale, {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  const formatRange = (start: string, end: string): string => {
    if (!start) return "—";
    if (ALL_DAY.test(start)) {
      const first = new Date(`${start}T00:00:00Z`);
      // Google's all-day end date is exclusive.
      const last = ALL_DAY.test(end)
        ? new Date(new Date(`${end}T00:00:00Z`).getTime() - DAY_MS)
        : first;
      const range =
        last.getTime() > first.getTime()
          ? `${dayFmt.format(first)} → ${dayFmt.format(last)}`
          : dayFmt.format(first);
      return `${range} · ${t("allDay")}`;
    }
    const s = new Date(start);
    if (Number.isNaN(s.getTime())) return start;
    const e = new Date(end);
    return Number.isNaN(e.getTime())
      ? dateTimeFmt.format(s)
      : `${dateTimeFmt.format(s)} → ${timeFmt.format(e)}`;
  };

  const [events, setEvents] = useState(initialEvents);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const startEdit = (e: CalendarEvent) => {
    const s = splitIso(e.start);
    const en = splitIso(e.end);
    setEditingId(e.id);
    setEdit({
      summary: e.summary,
      startDate: s.date,
      startTime: s.time,
      endDate: en.date,
      endTime: en.time,
      description: e.description,
    });
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEdit(null);
  };

  const saveEdit = (eventId: string) => {
    if (!edit) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/dashboard/calendar${qs}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, ...edit }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? t("errSaveFallback"));
        return;
      }
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId
            ? {
                ...e,
                summary: edit.summary,
                start: `${edit.startDate}T${edit.startTime}:00`,
                end: `${edit.endDate}T${edit.endTime}:00`,
                description: edit.description,
              }
            : e,
        ),
      );
      cancelEdit();
    });
  };

  const cancelEvent = (eventId: string) => {
    if (!confirm(t("confirmCancelAppointment"))) return;
    setError(null);
    startTransition(async () => {
      const deleteQs = asUserId
        ? `?eventId=${eventId}&asUserId=${encodeURIComponent(asUserId)}`
        : `?eventId=${eventId}`;
      const res = await fetch(`/api/dashboard/calendar${deleteQs}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? t("errSaveFallback"));
        return;
      }
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
    });
  };

  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-white p-8 text-center text-sm text-[var(--color-muted-foreground)]">
        {t("noUpcomingAppointments")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
      {events.map((e) => {
        const editing = editingId === e.id;
        return (
          <div
            key={e.id}
            className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            {editing && edit ? (
              <div className="flex flex-col gap-3">
                <input
                  type="text"
                  value={edit.summary}
                  onChange={(ev) =>
                    setEdit({ ...edit, summary: ev.target.value })
                  }
                  placeholder={t("titlePlaceholder")}
                  className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                />
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-muted-foreground)]">
                    {t("startLabel")}
                    <div className="flex gap-1">
                      <input
                        type="date"
                        value={edit.startDate}
                        onChange={(ev) =>
                          setEdit({ ...edit, startDate: ev.target.value })
                        }
                        className="flex-1 rounded-lg border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs"
                      />
                      <input
                        type="time"
                        value={edit.startTime}
                        onChange={(ev) =>
                          setEdit({ ...edit, startTime: ev.target.value })
                        }
                        className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs"
                      />
                    </div>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-muted-foreground)]">
                    {t("endLabel")}
                    <div className="flex gap-1">
                      <input
                        type="date"
                        value={edit.endDate}
                        onChange={(ev) =>
                          setEdit({ ...edit, endDate: ev.target.value })
                        }
                        className="flex-1 rounded-lg border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs"
                      />
                      <input
                        type="time"
                        value={edit.endTime}
                        onChange={(ev) =>
                          setEdit({ ...edit, endTime: ev.target.value })
                        }
                        className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs"
                      />
                    </div>
                  </label>
                </div>
                <textarea
                  value={edit.description}
                  onChange={(ev) =>
                    setEdit({ ...edit, description: ev.target.value })
                  }
                  placeholder={t("notesPlaceholder")}
                  rows={3}
                  className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-xs"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => saveEdit(e.id)}
                    disabled={isPending}
                    className="rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[#f472b6] px-4 py-1.5 text-xs font-medium text-white shadow-sm disabled:opacity-50"
                  >
                    {isPending ? t("savingButton") : t("saveButton")}
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="rounded-full border border-[var(--color-border)] bg-white px-4 py-1.5 text-xs font-medium text-[var(--color-foreground)]"
                  >
                    {t("cancelEditButton")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-base text-[var(--color-foreground)]">
                    {e.summary}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                    {formatRange(e.start, e.end)}
                  </p>
                  {e.description && (
                    <p className="mt-2 whitespace-pre-line text-xs text-[var(--color-muted-foreground)]">
                      {e.description}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={() => startEdit(e)}
                    className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1 text-xs font-medium text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
                  >
                    {t("editButton")}
                  </button>
                  <button
                    onClick={() => cancelEvent(e.id)}
                    disabled={isPending}
                    className="rounded-full px-3 py-1 text-xs font-medium text-[var(--color-destructive)] hover:bg-red-50 disabled:opacity-50"
                  >
                    {t("cancelAppointmentButton")}
                  </button>
                  {e.link && (
                    <a
                      href={e.link}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full px-3 py-1 text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                    >
                      {t("openLink")}
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
