import { getTranslations } from "next-intl/server";
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

export default async function CalendarPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);

  const t = await getTranslations({ locale, namespace: "DashboardCalendar" });

  let events: CalendarEvent[] | null = [];
  let selectedCalendarId = "primary";
  let error: string | null = null;
  try {
    const r = await fetchEvents(session.user.id);
    events = r.events;
    selectedCalendarId = r.selectedCalendarId;
  } catch (e) {
    error = e instanceof Error ? e.message : t("errFallback");
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
              {t("header")}
            </p>
            <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
              {t("title")}
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
              {notConnected
                ? t("notConnectedSubtitle")
                : t("eventCountSubtitle", { count: list.length })}
            </p>
          </div>
          {!notConnected && <SyncNowButton />}
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-8 pb-20">
        {notConnected ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p>{t("notConnectedBlock")}</p>
            <a
              href="/api/onboarding/google/start"
              className="rounded-full bg-[var(--color-foreground)] px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-[var(--color-primary)]"
            >
              {t("connectButton")}
            </a>
          </div>
        ) : tokenExpired ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p>{t("tokenExpiredBlock")}</p>
            <p className="text-xs italic">{t("techDetail")} {error}</p>
            <a
              href="/api/onboarding/google/start"
              className="rounded-full bg-[var(--color-foreground)] px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-[var(--color-primary)]"
            >
              {t("reconnectButton")}
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
