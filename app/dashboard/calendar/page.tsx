import { getCalendar } from "@/lib/google";
import { JERUSALEM_TZ } from "@/lib/tz";

import { CalendarTable } from "./calendar-table";

export const dynamic = "force-dynamic";

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  description: string;
  link: string;
}

async function fetchEvents(): Promise<CalendarEvent[]> {
  const calendar = getCalendar();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const res = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    timeZone: JERUSALEM_TZ,
    maxResults: 100,
  });

  return (res.data.items ?? []).map((e) => ({
    id: e.id ?? "",
    summary: e.summary ?? "(sans titre)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    description: e.description ?? "",
    link: e.htmlLink ?? "",
  }));
}

export default async function CalendarPage() {
  let events: CalendarEvent[] = [];
  let error: string | null = null;
  try {
    events = await fetchEvents();
  } catch (e) {
    error = e instanceof Error ? e.message : "Erreur calendrier";
  }

  return (
    <main>
      <section className="mx-auto w-full max-w-5xl px-6 pt-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
          Calendrier
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
          Vos prochains rendez-vous.
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
          {events.length} événement{events.length > 1 ? "s" : ""} dans les 30
          prochains jours, synchronisés avec Google Calendar. Modifiez l&apos;heure,
          le titre, ou annulez en un clic.
        </p>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-8 pb-20">
        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <CalendarTable initialEvents={events} />
        )}
      </section>
    </main>
  );
}
