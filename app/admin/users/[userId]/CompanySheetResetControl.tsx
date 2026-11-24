"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { AdminBadge } from "@/app/[locale]/dashboard/config/shared-ui";

type Undo = { resetId: string; createdAt: string; editedSinceReset: string[] } | null;

const FIELD_LABELS: Record<string, string> = {
  business: "fiche entreprise",
  knowledge: "anciennes entrées de connaissances",
  companySheet: "fiche entreprise du compte",
};

/**
 * Admin-only: clears the account's company sheet (company name, places,
 * services and prices, rules, notes, FAQ, and the old knowledge entries),
 * after a confirmation dialog, and offers to undo the latest clear
 * (POST /api/admin/users/[userId]/reset-company-sheet[/undo]).
 */
export function CompanySheetResetControl({ userId }: { userId: string }) {
  const [undo, setUndo] = useState<Undo>(null);
  const [confirming, setConfirming] = useState<"reset" | "undo" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Bumped after each action to re-read whether an undo is available.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/users/${userId}/reset-company-sheet`)
      .then((res) => (res.ok ? (res.json() as Promise<{ undo: Undo }>) : null))
      .then((data) => {
        if (!cancelled && data) setUndo(data.undo);
      })
      .catch(() => {
        /* the undo button just stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, [userId, version]);

  const post = async (path: string, body?: unknown) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setMessage(`Échec : ${data.error ?? res.status}`);
      else setMessage(path === "reset-company-sheet" ? "Fiche entreprise vidée." : "Vidage annulé.");
      return res.ok;
    } finally {
      setBusy(false);
      setConfirming(null);
      setVersion((v) => v + 1);
    }
  };

  const edited = undo?.editedSinceReset ?? [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <AdminBadge size="xs" />
      <button
        type="button"
        onClick={() => setConfirming("reset")}
        disabled={busy}
        className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1 text-xs font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-muted)] disabled:opacity-50"
      >
        Vider la fiche entreprise
      </button>
      {undo && (
        <button
          type="button"
          onClick={() => setConfirming("undo")}
          disabled={busy}
          className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1 text-xs font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-muted)] disabled:opacity-50"
        >
          Annuler le vidage
        </button>
      )}
      {message && <span className="text-xs">{message}</span>}

      {confirming && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="company-sheet-reset-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5 text-sm text-[var(--color-foreground)] shadow-xl">
            <h2 id="company-sheet-reset-title" className="mb-2 flex items-center gap-2 text-base font-semibold">
              {confirming === "reset" ? "Vider la fiche entreprise ?" : "Annuler le vidage ?"} <AdminBadge size="xs" />
            </h2>
            {confirming === "reset" ? (
              <>
                <p>Seront supprimés de la fiche entreprise de ce compte :</p>
                <ul className="my-2 list-disc pl-5">
                  <li>le nom de l&apos;entreprise (et son slogan, son e-mail) ;</li>
                  <li>les lieux et leurs horaires ;</li>
                  <li>les prestations et leurs prix ;</li>
                  <li>les règles ;</li>
                  <li>les notes ;</li>
                  <li>la FAQ ;</li>
                  <li>les anciennes entrées de connaissances.</li>
                </ul>
                <p>
                  La persona, la voix, la langue et les outils ne changent pas. Les valeurs actuelles sont conservées : le
                  vidage peut être annulé.
                </p>
              </>
            ) : (
              <p>
                La fiche entreprise et les anciennes entrées de connaissances reprendront exactement leurs valeurs
                d&apos;avant le vidage.
                {edited.length > 0 && (
                  <>
                    {" "}
                    <strong>
                      Attention : modifié depuis le vidage ({edited.map((f) => FIELD_LABELS[f] ?? f).join(", ")}).
                      Ces modifications seront perdues.
                    </strong>
                  </>
                )}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                disabled={busy}
                className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  confirming === "reset"
                    ? void post("reset-company-sheet")
                    : undo && void post("reset-company-sheet/undo", { resetId: undo.resetId, force: edited.length > 0 })
                }
                className="rounded-full bg-[#be185d] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
