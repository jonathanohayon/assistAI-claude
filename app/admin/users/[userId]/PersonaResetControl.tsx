"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { AdminBadge } from "@/app/[locale]/dashboard/config/shared-ui";

type Undo = { resetId: string; createdAt: string; editedSinceReset: string[] } | null;

const FIELD_LABELS: Record<string, string> = {
  instructions: "instructions",
  greetingInstructions: "phrase d'accueil",
  agentName: "nom de l'agent",
};

/**
 * Admin-only: resets the account's persona (instructions, greeting, agent
 * name) to the neutral default, after a confirmation dialog, and offers to
 * undo the latest reset (POST /api/admin/users/[userId]/reset-persona[/undo]).
 */
export function PersonaResetControl({ userId }: { userId: string }) {
  const [undo, setUndo] = useState<Undo>(null);
  const [confirming, setConfirming] = useState<"reset" | "undo" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Bumped after each action to re-read whether an undo is available.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/users/${userId}/reset-persona`)
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
      else setMessage(path === "reset-persona" ? "Persona réinitialisée." : "Réinitialisation annulée.");
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
        Réinitialiser la persona
      </button>
      {undo && (
        <button
          type="button"
          onClick={() => setConfirming("undo")}
          disabled={busy}
          className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1 text-xs font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-muted)] disabled:opacity-50"
        >
          Annuler la réinitialisation
        </button>
      )}
      {message && <span className="text-xs">{message}</span>}

      {confirming && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="persona-reset-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5 text-sm text-[var(--color-foreground)] shadow-xl">
            <h2 id="persona-reset-title" className="mb-2 flex items-center gap-2 text-base font-semibold">
              {confirming === "reset" ? "Réinitialiser la persona ?" : "Annuler la réinitialisation ?"} <AdminBadge size="xs" />
            </h2>
            {confirming === "reset" ? (
              <p>
                Les <strong>instructions</strong>, la <strong>phrase d&apos;accueil</strong> et le{" "}
                <strong>nom de l&apos;agent</strong> de ce compte seront remplacés par la persona neutre par défaut
                (dans la langue de l&apos;agent). La voix, la langue, les outils et la fiche entreprise ne changent pas. Les
                valeurs actuelles sont conservées : la réinitialisation peut être annulée.
              </p>
            ) : (
              <p>
                Les instructions, la phrase d&apos;accueil et le nom de l&apos;agent reprendront exactement leurs valeurs
                d&apos;avant la réinitialisation.
                {edited.length > 0 && (
                  <>
                    {" "}
                    <strong>
                      Attention : modifié depuis la réinitialisation ({edited.map((f) => FIELD_LABELS[f] ?? f).join(", ")}).
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
                    ? void post("reset-persona")
                    : undo && void post("reset-persona/undo", { resetId: undo.resetId, force: edited.length > 0 })
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
