import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getTenantGoogleClients } from "@/lib/google";
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

async function fetchEvents(userId: string): Promise<CalendarEvent[] | null> {
  const clients = await getTenantGoogleClients(userId);
  if (!clients) return null;

  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const res = await clients.calendar.events.list({
    calendarId: clients.calendarId,
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
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  let events: CalendarEvent[] | null = [];
  let error: string | null = null;
  try {
    events = await fetchEvents(session.user.id);
  } catch (e) {
    error = e instanceof Error ? e.message : "Erreur calendrier";
  }

  const notConnected = events === null;
  const list = events ?? [];

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
          {notConnected
            ? "Connectez Google Calendar pour voir vos rendez-vous ici."
            : `${list.length} événement${list.length > 1 ? "s" : ""} dans les 30 prochains jours, synchronisés avec Google Calendar. Modifiez l'heure, le titre, ou annulez en un clic.`}
        </p>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-8 pb-20">
        {notConnected ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p>
              Google Calendar n&apos;est pas encore connecté à votre compte.
              Sans ça, votre agent ne peut pas réserver dans VOTRE calendrier.
            </p>
            <a
              href="/api/onboarding/google/start"
              className="rounded-full bg-[var(--color-foreground)] px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-[var(--color-primary)]"
            >
              Connecter Google
            </a>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <CalendarTable initialEvents={list} />
        )}
      </section>
    </main>
  );
}
