import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ContactsTable } from "@/app/[locale]/dashboard/contacts/contacts-table";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getTenantGoogleClients } from "@/lib/google";
import { requireAdminPage } from "@/lib/auth/require-admin-page";

export const dynamic = "force-dynamic";

interface Contact {
  rowIndex: number;
  timestamp: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
}

type FetchResult =
  | { status: "ok"; contacts: Contact[] }
  | { status: "no_google" }
  | { status: "no_sheet" };

// Admin contacts view = mirror exact de /dashboard/contacts pour le
// tenant cible. Réutilise ContactsTable avec asUserId.
async function fetchContacts(userId: string): Promise<FetchResult> {
  const clients = await getTenantGoogleClients(userId);
  if (!clients) return { status: "no_google" };
  if (!clients.sheetId) return { status: "no_sheet" };

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

  const contacts: Contact[] = rows.slice(startIndex).map((r, i) => ({
    rowIndex: startIndex + i + 1,
    timestamp: r[0] ?? "",
    name: r[1] ?? "",
    phone: r[2] ?? "",
    email: r[3] ?? "",
    notes: r[4] ?? "",
  }));
  contacts.reverse();
  return { status: "ok", contacts };
}

export default async function AdminTenantContactsPage({
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
    namespace: "DashboardContacts",
  });

  let result: FetchResult = { status: "ok", contacts: [] };
  let error: string | null = null;
  try {
    result = await fetchContacts(target.id);
  } catch (e) {
    error = e instanceof Error ? e.message : t("errFallback");
  }

  const contacts = result.status === "ok" ? result.contacts : [];
  const nonEmptyCount = contacts.filter((c) => c.name || c.phone).length;

  return (
    <main>
      <section className="mx-auto w-full max-w-6xl px-6 pt-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
          {t("header")}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
          {t("title")}
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
          {result.status === "ok"
            ? t("subtitleConnected", { count: nonEmptyCount })
            : t("subtitleDisconnected")}
        </p>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-8 pb-20">
        {result.status === "no_google" ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Le tenant n&apos;a pas connecté Google. L&apos;admin ne peut pas
            le faire à sa place (OAuth nécessite session tenant).
          </div>
        ) : result.status === "no_sheet" ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            {t("noSheetConfigured")}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <ContactsTable initial={contacts} asUserId={target.id} />
        )}
      </section>
    </main>
  );
}
