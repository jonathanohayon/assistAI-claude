import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getTenantGoogleClients } from "@/lib/google";
import { featuresForPlan } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import { JERUSALEM_TZ } from "@/lib/tz";

import { CrmClient } from "./crm-client";

export const dynamic = "force-dynamic";

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  description: string;
  link: string;
}

interface Contact {
  rowIndex: number;
  timestamp: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
}

interface CrmData {
  googleConnected: boolean;
  tokenExpired: boolean;
  events: CalendarEvent[];
  contacts: Contact[];
  selectedCalendarId: string;
  customersSheetId: string | null;
}

// Récupère en un seul passage la connexion Google + les événements agenda
// (fenêtre J→J+30, même logique que calendar/page.tsx) et les contacts
// (Sheet "Contacts!A:E", même logique que contacts/page.tsx). On distingue
// le cas "token mort" (invalid_grant) du cas "jamais connecté".
async function fetchCrmData(userId: string): Promise<CrmData> {
  const clients = await getTenantGoogleClients(userId);
  if (!clients) {
    return {
      googleConnected: false,
      tokenExpired: false,
      events: [],
      contacts: [],
      selectedCalendarId: "primary",
      customersSheetId: null,
    };
  }

  let events: CalendarEvent[] = [];
  let contacts: Contact[] = [];
  let tokenExpired = false;

  // ── Agenda (fenêtre J→J+30) ──────────────────────────────────────────
  try {
    const timeMin = new Date().toISOString();
    const timeMax = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const res = await clients.calendar.events.list({
      calendarId: clients.calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      timeZone: JERUSALEM_TZ,
      maxResults: 100,
    });
    events = (res.data.items ?? []).map((e) => ({
      id: e.id ?? "",
      summary: e.summary ?? "(sans titre)",
      start: e.start?.dateTime ?? e.start?.date ?? "",
      end: e.end?.dateTime ?? e.end?.date ?? "",
      description: e.description ?? "",
      link: e.htmlLink ?? "",
    }));
  } catch {
    // DB dit "connected" mais l'API throw → refresh token mort (invalid_grant).
    tokenExpired = true;
  }

  // ── Contacts (Sheet "Contacts!A:E") ──────────────────────────────────
  if (clients.sheetId) {
    try {
      const res = await clients.sheets.spreadsheets.values.get({
        spreadsheetId: clients.sheetId,
        range: "Contacts!A:E",
      });
      const rows = res.data.values ?? [];
      const startIndex =
        rows[0]?.[0]?.toString().toLowerCase().includes("timestamp") ||
        rows[0]?.[1]?.toString().toLowerCase().includes("nom")
          ? 1
          : 0;
      contacts = rows.slice(startIndex).map((r, i) => ({
        rowIndex: startIndex + i + 1,
        timestamp: r[0] ?? "",
        name: r[1] ?? "",
        phone: r[2] ?? "",
        email: r[3] ?? "",
        notes: r[4] ?? "",
      }));
      contacts.reverse();
    } catch {
      tokenExpired = true;
    }
  }

  return {
    googleConnected: true,
    tokenExpired,
    events,
    contacts,
    selectedCalendarId: clients.calendarId,
    customersSheetId: clients.sheetId,
  };
}

export default async function CrmPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);

  const t = await getTranslations({ locale, namespace: "DashboardCrm" });

  const [me] = await db
    .select({
      role: users.role,
      subscriptionPlan: users.subscriptionPlan,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const isAdmin = me?.role === "admin";
  const planMatrix = await getPlanFeatureMatrix();
  const features = featuresForPlan(planMatrix, me?.subscriptionPlan);

  const data = await fetchCrmData(session.user.id);

  return (
    <main>
      <section className="mx-auto w-full max-w-5xl px-6 pt-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
          {t("header")}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
          {t("title")}
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
          {t("subtitle")}
        </p>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-8 pb-20">
        <CrmClient
          events={data.events}
          contacts={data.contacts}
          googleConnected={data.googleConnected}
          tokenExpired={data.tokenExpired}
          selectedCalendarId={data.selectedCalendarId}
          hasCalendar={features.calendar}
          hasCrm={features.crm}
          isAdmin={isAdmin}
        />
      </section>
    </main>
  );
}
