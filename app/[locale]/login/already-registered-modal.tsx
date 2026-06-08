"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

/**
 * Popup affiché quand un utilisateur tente de S'INSCRIRE via Google alors
 * qu'un compte existe déjà (callback signIn → redirect /login?notice=exists).
 * Le but : lui dire de se connecter au lieu de créer un doublon.
 */
export function AlreadyRegisteredModal() {
  const t = useTranslations("Login");
  const [open, setOpen] = useState(true);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    // Nettoie l'URL pour éviter de ré-afficher le popup à un refresh.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("notice");
      window.history.replaceState({}, "", url.toString());
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-sm rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-xl">
        <h2 className="font-display text-lg tracking-tight text-[var(--color-foreground)]">
          {t("alreadyRegisteredTitle")}
        </h2>
        <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
          {t("alreadyRegisteredBody")}
        </p>
        <button
          type="button"
          onClick={close}
          className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white shadow-md transition-transform hover:scale-[1.01] active:scale-[0.99]"
        >
          {t("alreadyRegisteredOk")}
        </button>
      </div>
    </div>
  );
}
