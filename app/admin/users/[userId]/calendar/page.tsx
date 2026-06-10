import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { CalendarSettings } from "@/app/[locale]/dashboard/calendar/calendar-settings";
import { CalendarTable } from "@/app/[locale]/dashboard/calendar/calendar-table";
import { SyncNowButton } from "@/app/[locale]/dashboard/calendar/sync-button";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getTenantGoogleClients } from "@/lib/google";
import { JERUSALEM_TZ } from "@/lib/tz";
import { requireAdminPage } from "@/lib/auth/require-admin-page";

export const dynamic = "force-dynamic";

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  description: string;
  link: string;
}

// Admin calendar view = exactement la même page que /dashboard/calendar
// mais scopée sur le tenant cible via asUserId. Composants client
// (CalendarTable, CalendarSettings, SyncNowButton) sont importés depuis
// le dashboard user et reçoivent la prop asUserId qu'ils propagent à
// leurs fetches API (route admin-impersonation via resolveScopeUserId).
async function fetchEvents(userId: string): Promise<{
  events: CalendarEvent[] | null;
  selectedCalendarId: string;
}> {
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

export default async function AdminTenantCalendarPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  await requireAdminPage();

  const { userId } = await params;
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) redirect("/admin");

  const t = await getTranslations({
    locale: "fr",
    namespace: "DashboardCalendar",
  });

  let events: CalendarEvent[] | null = [];
  let selectedCalendarId = "primary";
  let error: string | null = null;
  try {
    const r = await fetchEvents(target.id);
    events = r.events;
    selectedCalendarId = r.selectedCalendarId;
  } catch (e) {
    error = e instanceof Error ? e.message : t("errFallback");
  }

  const notConnected = events === null;
  const list = events ?? [];
  const tokenExpired = !notConnected && error !== null;

  return (
    <main>
      <section className="mx-auto w-full max-w-6xl px-6 pt-10">
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
          {!notConnected && <SyncNowButton asUserId={target.id} />}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-8 pb-20">
        {notConnected ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p>{t("notConnectedBlock")}</p>
            <p className="text-xs italic">
              Le tenant n&apos;a pas connecté son Google. L&apos;admin ne peut
              pas connecter Google à sa place (OAuth flow nécessite session
              tenant). Demande au tenant de cliquer Connect Google sur son
              dashboard.
            </p>
          </div>
        ) : tokenExpired ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p>{t("tokenExpiredBlock")}</p>
            <p className="text-xs italic">
              {t("techDetail")} {error}
            </p>
            <p className="text-xs italic">
              Token expiré côté tenant — demande au tenant de reconnecter.
            </p>
          </div>
        ) : (
          <>
            <CalendarSettings
              initialSelectedId={selectedCalendarId}
              asUserId={target.id}
            />
            <CalendarTable initialEvents={list} asUserId={target.id} />
          </>
        )}
      </section>
    </main>
  );
}
