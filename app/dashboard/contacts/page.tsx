import { getSheets } from "@/lib/google";

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

async function fetchContacts(): Promise<Contact[]> {
  const sheets = getSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID non configuré");

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
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
  return contacts;
}

export default async function ContactsPage() {
  let contacts: Contact[] = [];
  let error: string | null = null;
  try {
    contacts = await fetchContacts();
  } catch (e) {
    error = e instanceof Error ? e.message : "Erreur sheet";
  }

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
          {contacts.filter((c) => c.name || c.phone).length} contact
          {contacts.length > 1 ? "s" : ""} enregistrés dans votre Google Sheet.
          Chaque appel ajoute une ligne automatiquement.
        </p>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-8 pb-20">
        {error ? (
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
