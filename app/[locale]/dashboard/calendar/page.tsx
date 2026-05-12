import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getTenantGoogleClients } from "@/lib/google";
import { JERUSALEM_TZ } from "@/lib/tz";

import { CalendarSettings } from "./calendar-settings";
import { CalendarTable } from "./calendar-table";
import { SyncNowButton } from "./sync-button";

export const dynamic = "force-dynamic";

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  description: string;
  link: string;
}

interface FetchResult {
  events: CalendarEvent[] | null;
  selectedCalendarId: string;
}

async function fetchEvents(userId: string): Promise<FetchResult> {
  const clients = await getTenantGoogleClients(userId);
  if (!clients) return { events: null, selectedCalendarId: "primary" };

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

  return {
    events: (res.data.items ?? []).map((e) => ({
      id: e.id ?? "",
      summary: e.summary ?? "(sans titre)",
      start: e.start?.dateTime ?? e.start?.date ?? "",
      end: e.end?.dateTime ?? e.end?.date ?? "",
      description: e.description ?? "",
      link: e.htmlLink ?? "",
    })),
    selectedCalendarId: clients.calendarId,
  };
}

export default async function CalendarPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  let events: CalendarEvent[] | null = [];
  let selectedCalendarId = "primary";
  let error: string | null = null;
  try {
    const r = await fetchEvents(session.user.id);
    events = r.events;
    selectedCalendarId = r.selectedCalendarId;
  } catch (e) {
    error = e instanceof Error ? e.message : "Erreur calendrier";
  }

  const notConnected = events === null;
  const list = events ?? [];
  // Token mort (invalid_grant) → DB dit "connected" mais l'API throw. On
  // distingue ce cas pour proposer "Reconnecter" plutôt que "Connecter".
  const tokenExpired = !notConnected && error !== null;

  return (
    <main>
      <section className="mx-auto w-full max-w-5xl px-6 pt-10">
        <div className="flex items-start justify-between gap-4">
          <div>
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
          </div>
          {!notConnected && <SyncNowButton />}
        </div>
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
        ) : tokenExpired ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p>
              Ta connexion Google semble expirée — impossible de récupérer tes
              événements. Reconnecte ton compte pour rétablir l&apos;accès
              (l&apos;agent ne peut plus réserver de RDV en attendant).
            </p>
            <p className="text-xs italic">Détail technique : {error}</p>
            <a
              href="/api/onboarding/google/start"
              className="rounded-full bg-[var(--color-foreground)] px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-[var(--color-primary)]"
            >
              Reconnecter Google
            </a>
          </div>
        ) : (
          <>
            <CalendarSettings initialSelectedId={selectedCalendarId} />
            <CalendarTable initialEvents={list} />
          </>
        )}
      </section>
    </main>
  );
}
