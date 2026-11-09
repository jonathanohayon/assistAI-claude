"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";

import {
  type ClientVisits,
  visitsByPhone,
  visitsFor,
} from "@/lib/contacts/loyalty-join";

interface Contact {
  rowIndex: number;
  timestamp: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
}

export function ContactsTable({
  initial,
  asUserId,
}: {
  initial: Contact[];
  /** Admin agissant sur un tenant — propagé aux APIs /api/dashboard/contacts. */
  asUserId?: string;
}) {
  const t = useTranslations("DashboardContacts");
  const [contacts, setContacts] = useState(initial);
  const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<Contact>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const locale = useLocale();

  // Loyalty (past Calendar bookings per phone). Optional: empty without
  // Calendar or before the first sync, and a failure just hides the columns.
  const [visits, setVisits] = useState<ClientVisits[] | null>(null);
  const [regularMin, setRegularMin] = useState(3);
  const [regularsOnly, setRegularsOnly] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dashboard/client-visits${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("visits"))))
      .then((data: { regularMinVisits?: number; clients?: ClientVisits[] }) => {
        if (cancelled) return;
        setVisits(data.clients ?? []);
        if (data.regularMinVisits) setRegularMin(data.regularMinVisits);
      })
      .catch(() => {
        if (!cancelled) setVisits(null);
      });
    return () => {
      cancelled = true;
    };
  }, [qs]);
  const visitIndex = useMemo(() => visitsByPhone(visits ?? []), [visits]);
  const showLoyalty = visits !== null && visits.length > 0;
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }),
    [locale],
  );

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
      const res = await fetch(`/api/dashboard/contacts${qs}`, {
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
      const deleteQs = asUserId
        ? `?rowIndex=${rowIndex}&asUserId=${encodeURIComponent(asUserId)}`
        : `?rowIndex=${rowIndex}`;
      const res = await fetch(
        `/api/dashboard/contacts${deleteQs}`,
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

  const nonEmpty = contacts.filter((c) => c.name || c.phone || c.email);
  const regularCount = showLoyalty
    ? nonEmpty.filter((c) => visitsFor(visitIndex, c.phone)?.regular).length
    : 0;
  const visible =
    showLoyalty && regularsOnly
      ? nonEmpty.filter((c) => visitsFor(visitIndex, c.phone)?.regular)
      : nonEmpty;
  if (nonEmpty.length === 0) {
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

      {showLoyalty && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={regularsOnly}
            onClick={() => setRegularsOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ${
              regularsOnly
                ? "bg-[#0e7490] text-white ring-[#0e7490]"
                : "bg-white text-[var(--color-foreground)] ring-[var(--color-border)] hover:bg-[var(--color-muted)]"
            }`}
          >
            <StarIcon />
            {t("filterRegulars", { n: regularCount })}
          </button>
          <span className="text-[11px] text-[var(--color-muted-foreground)]">
            {t("regularRule", { n: regularMin })}
          </span>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-muted)]/50 text-start text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
            <tr>
              <th className="px-4 py-3 font-medium">{t("colName")}</th>
              <th className="px-4 py-3 font-medium">{t("colPhone")}</th>
              <th className="px-4 py-3 font-medium">{t("colEmail")}</th>
              {showLoyalty && (
                <>
                  <th className="px-4 py-3 text-end font-medium">{t("colVisits")}</th>
                  <th className="px-4 py-3 font-medium">{t("colLastVisit")}</th>
                </>
              )}
              <th className="px-4 py-3 font-medium">{t("colNotes")}</th>
              <th className="px-4 py-3 font-medium">{t("colAdded")}</th>
              <th className="px-4 py-3 font-medium text-end">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]/60">
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-xs text-[var(--color-muted-foreground)]">
                  {t("noRegulars")}
                </td>
              </tr>
            )}
            {visible.map((c) => {
              const editing = editingRow === c.rowIndex;
              const v = showLoyalty ? visitsFor(visitIndex, c.phone) : null;
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
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-[var(--color-foreground)]">
                          {c.name || "—"}
                        </span>
                        {v?.regular && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfeff] px-2 py-0.5 text-[10px] font-semibold text-[#0e7490] ring-1 ring-[#a5f3fc]">
                            <StarIcon />
                            {t("regularBadge")}
                          </span>
                        )}
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
                      // dir=ltr: in Hebrew, "+972…" and "050 000 0000" would
                      // otherwise render reversed ("…972+").
                      <span dir="ltr">{c.phone || "—"}</span>
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
                  {showLoyalty && (
                    <>
                      <td className="px-4 py-3 text-end align-top text-xs font-semibold tabular-nums">
                        {v ? v.visits : <span className="font-normal text-[var(--color-muted-foreground)]">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 align-top text-xs text-[var(--color-muted-foreground)]">
                        {v?.lastVisitAt ? dateFmt.format(new Date(v.lastVisitAt)) : "—"}
                        {v?.nextVisitAt && (
                          <span className="mt-0.5 block text-[11px] text-[#0e7490]">
                            {t("nextVisit", { date: dateFmt.format(new Date(v.nextVisitAt)) })}
                          </span>
                        )}
                      </td>
                    </>
                  )}
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

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3" aria-hidden>
      <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" />
    </svg>
  );
}
