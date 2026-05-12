"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

interface Contact {
  rowIndex: number;
  timestamp: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
}

export function ContactsTable({ initial }: { initial: Contact[] }) {
  const t = useTranslations("DashboardContacts");
  const [contacts, setContacts] = useState(initial);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<Contact>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const startEdit = (c: Contact) => {
    setEditingRow(c.rowIndex);
    setDraft({
      name: c.name,
      phone: c.phone,
      email: c.email,
      notes: c.notes,
    });
    setError(null);
  };

  const cancelEdit = () => {
    setEditingRow(null);
    setDraft({});
  };

  const saveEdit = (rowIndex: number) => {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/dashboard/contacts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex, ...draft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? t("errSave"));
        return;
      }
      setContacts((prev) =>
        prev.map((c) =>
          c.rowIndex === rowIndex ? { ...c, ...(draft as Contact) } : c,
        ),
      );
      cancelEdit();
    });
  };

  const deleteContact = (rowIndex: number) => {
    if (!confirm(t("confirmDelete"))) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(
        `/api/dashboard/contacts?rowIndex=${rowIndex}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? t("errSave"));
        return;
      }
      setContacts((prev) => prev.filter((c) => c.rowIndex !== rowIndex));
    });
  };

  const visible = contacts.filter((c) => c.name || c.phone || c.email);
  if (visible.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-white p-8 text-center text-sm text-[var(--color-muted-foreground)]">
        {t("noContacts")}
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

      <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-muted)]/50 text-left text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
            <tr>
              <th className="px-4 py-3 font-medium">{t("colName")}</th>
              <th className="px-4 py-3 font-medium">{t("colPhone")}</th>
              <th className="px-4 py-3 font-medium">{t("colEmail")}</th>
              <th className="px-4 py-3 font-medium">{t("colNotes")}</th>
              <th className="px-4 py-3 font-medium">{t("colAdded")}</th>
              <th className="px-4 py-3 font-medium text-right">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]/60">
            {visible.map((c) => {
              const editing = editingRow === c.rowIndex;
              return (
                <tr key={c.rowIndex}>
                  <td className="px-4 py-3 align-top">
                    {editing ? (
                      <input
                        type="text"
                        value={draft.name ?? ""}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, name: e.target.value }))
                        }
                        className="w-full rounded border border-[var(--color-border)] px-2 py-1 text-xs"
                      />
                    ) : (
                      <span className="font-medium text-[var(--color-foreground)]">
                        {c.name || "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top font-mono text-xs">
                    {editing ? (
                      <input
                        type="tel"
                        value={draft.phone ?? ""}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, phone: e.target.value }))
                        }
                        className="w-full rounded border border-[var(--color-border)] px-2 py-1 font-mono text-xs"
                      />
                    ) : (
                      c.phone || "—"
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-xs">
                    {editing ? (
                      <input
                        type="email"
                        value={draft.email ?? ""}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, email: e.target.value }))
                        }
                        className="w-full rounded border border-[var(--color-border)] px-2 py-1 text-xs"
                      />
                    ) : (
                      c.email || "—"
                    )}
                  </td>
                  <td className="max-w-[200px] px-4 py-3 align-top text-xs text-[var(--color-muted-foreground)]">
                    {editing ? (
                      <textarea
                        value={draft.notes ?? ""}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, notes: e.target.value }))
                        }
                        rows={2}
                        className="w-full rounded border border-[var(--color-border)] px-2 py-1 text-xs"
                      />
                    ) : (
                      <span className="line-clamp-2 whitespace-pre-line">
                        {c.notes || "—"}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 align-top text-xs text-[var(--color-muted-foreground)]">
                    {c.timestamp || "—"}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex justify-end gap-1.5">
                      {editing ? (
                        <>
                          <button
                            onClick={() => saveEdit(c.rowIndex)}
                            disabled={isPending}
                            className="rounded-full bg-[var(--color-foreground)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {isPending ? "…" : "OK"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="rounded-full px-2 py-1 text-xs text-[var(--color-muted-foreground)]"
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(c)}
                            className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1 text-xs font-medium hover:bg-[var(--color-muted)]"
                          >
                            {t("editButton")}
                          </button>
                          <button
                            onClick={() => deleteContact(c.rowIndex)}
                            disabled={isPending}
                            className="rounded-full px-2 py-1 text-xs text-[var(--color-destructive)] hover:bg-red-50 disabled:opacity-50"
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
