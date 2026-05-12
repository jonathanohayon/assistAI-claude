import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getTenantGoogleClients } from "@/lib/google";

import { ContactsTable } from "./contacts-table";

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

export default async function ContactsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  let result: FetchResult = { status: "ok", contacts: [] };
  let error: string | null = null;
  try {
    result = await fetchContacts(session.user.id);
  } catch (e) {
    error = e instanceof Error ? e.message : "Erreur sheet";
  }

  const contacts = result.status === "ok" ? result.contacts : [];

  return (
    <main>
      <section className="mx-auto w-full max-w-5xl px-6 pt-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
          Contacts CRM
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
          Vos clientes en un coup d&apos;œil.
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
          {result.status === "ok"
            ? `${contacts.filter((c) => c.name || c.phone).length} contact${contacts.length > 1 ? "s" : ""} enregistrés dans votre Google Sheet. Chaque appel ajoute une ligne automatiquement.`
            : "Connectez Google et configurez votre Sheet pour suivre vos contacts ici."}
        </p>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-8 pb-20">
        {result.status === "no_google" ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p>Google n&apos;est pas connecté à votre compte.</p>
            <a
              href="/api/onboarding/google/start"
              className="rounded-full bg-[var(--color-foreground)] px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-[var(--color-primary)]"
            >
              Connecter Google
            </a>
          </div>
        ) : result.status === "no_sheet" ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Aucun Google Sheet configuré. Renseignez l&apos;ID de votre Sheet dans les paramètres pour activer le CRM.
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <ContactsTable initial={contacts} />
        )}
      </section>
    </main>
  );
}
