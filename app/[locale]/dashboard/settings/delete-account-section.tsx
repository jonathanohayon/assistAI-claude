"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

interface DeleteAccountSectionProps {
  email: string;
}

/**
 * UI danger zone : 2 étapes pour delete son compte.
 *
 *   1. Click "Supprimer mon compte" → ouvre un confirm modal-like
 *   2. User retape son email pour confirmer
 *   3. POST /api/dashboard/delete-account
 *   4. Redirect / (signOut côté server)
 *
 * Pattern UX standard SaaS pour actions destructives — Stripe / GitHub
 * / Vercel font tous pareil avec retape de l'identifiant.
 */
export function DeleteAccountSection({ email }: DeleteAccountSectionProps) {
  const t = useTranslations("DashboardSettings");
  const [opened, setOpened] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (confirm.trim().toLowerCase() !== email.toLowerCase()) {
      setError(t("errEmailMismatch"));
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/dashboard/delete-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmEmail: confirm }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          setError(data.error ?? t("errStatus", { status: res.status }));
          return;
        }
        // Compte supprimé → redirige hors-app
        window.location.href = "/?bye=1";
      } catch (e) {
        setError(e instanceof Error ? e.message : t("errNetwork"));
      }
    });
  };

  if (!opened) {
    return (
      <button
        type="button"
        onClick={() => setOpened(true)}
        className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--color-destructive)]/40 bg-white px-4 py-2 text-xs font-medium text-[var(--color-destructive)] transition-colors hover:bg-[var(--color-destructive)] hover:text-white"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
          <path
            d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6M14 11v6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {t("deleteButton")}
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 flex flex-col gap-3 rounded-xl bg-white p-4 ring-1 ring-inset ring-red-200"
    >
      <p className="text-sm text-red-900">
        {t("confirmRetypeEmailPre")}{" "}
        <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-xs">
          {email}
        </code>
        .
      </p>
      <input
        type="email"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="off"
        placeholder={email}
        className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-[var(--color-foreground)] shadow-xs focus:border-red-400 focus:outline-none focus:ring-4 focus:ring-red-100"
        autoFocus
      />
      {error && (
        <p className="text-xs text-[var(--color-destructive)]">{error}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={isPending || confirm.trim() === ""}
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-destructive)] px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-[#a21717] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? t("deletingButton") : t("confirmDeleteButton")}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpened(false);
            setConfirm("");
            setError(null);
          }}
          disabled={isPending}
          className="rounded-full px-3 py-2 text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          {t("cancelButton")}
        </button>
      </div>
    </form>
  );
}
