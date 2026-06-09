"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

/**
 * Définir / mettre à jour son mot de passe. Utile surtout pour les comptes
 * inscrits via Google (pas de mot de passe) qui veulent aussi se connecter
 * en email + mot de passe. POST /api/dashboard/set-password.
 */
export function PasswordSection() {
  const t = useTranslations("DashboardSettings");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (pw.length < 8) {
      setMsg({ ok: false, text: t("passwordTooShort") });
      return;
    }
    if (pw !== confirm) {
      setMsg({ ok: false, text: t("passwordMismatch") });
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/dashboard/set-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pw }),
        });
        if (res.ok) {
          setMsg({ ok: true, text: t("passwordSaved") });
          setPw("");
          setConfirm("");
        } else {
          setMsg({ ok: false, text: t("passwordError") });
        }
      } catch {
        setMsg({ ok: false, text: t("passwordError") });
      }
    });
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm shadow-xs focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20";

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--color-muted-foreground)]">
            {t("passwordNewLabel")}
          </span>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--color-muted-foreground)]">
            {t("passwordConfirmLabel")}
          </span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            className={inputCls}
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || !pw || !confirm}
          className="rounded-full bg-[var(--color-foreground)] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--color-primary)] disabled:opacity-50"
        >
          {isPending ? t("passwordSaving") : t("passwordSave")}
        </button>
        {msg && (
          <span
            className={`text-xs font-medium ${
              msg.ok ? "text-[#16a34a]" : "text-red-600"
            }`}
          >
            {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}
