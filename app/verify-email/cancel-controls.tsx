"use client";

import { useState, useTransition } from "react";

/**
 * Bouton (×) en haut à droite de la card /verify-email.
 * Effet : signOut (clear cookie session) + redirige vers /. Le compte reste
 * en DB ; le user peut se reconnecter plus tard pour finir la vérification.
 */
export function CancelButton() {
  const [isPending, startTransition] = useTransition();
  const onClick = () => {
    startTransition(async () => {
      try {
        await fetch("/api/admin/auth/signout", { method: "POST" });
      } catch {
        /* ignore */
      }
      window.location.href = "/";
    });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      aria-label="Annuler et retourner à l'accueil"
      className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:opacity-50"
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <path
          d="M6 6l12 12M18 6L6 18"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/**
 * Lien "Recommencer avec un autre email" en bas de la card. Confirme avec
 * window.confirm parce que c'est destructif (delete le compte). Si OK,
 * appelle /api/auth/cancel-signup qui delete le user + signOut, puis
 * redirige vers /signup pour repartir clean.
 */
export function RestartLink() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onClick = () => {
    if (
      !window.confirm(
        "Supprimer ce signup et recommencer ?\n\nLe compte créé sera définitivement effacé. Tu pourras te réinscrire avec le même ou un autre email.",
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/cancel-signup", { method: "POST" });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          setError(data.error ?? `Erreur ${res.status}`);
          return;
        }
        window.location.href = "/signup";
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur réseau");
      }
    });
  };

  return (
    <div className="flex flex-col items-center gap-1 border-t border-[var(--color-border)]/60 pt-4">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="text-xs text-[var(--color-muted-foreground)] underline underline-offset-2 transition-colors hover:text-[var(--color-foreground)] disabled:opacity-50"
      >
        Recommencer avec un autre email
      </button>
      {error && (
        <p className="text-[11px] text-[var(--color-destructive)]">{error}</p>
      )}
    </div>
  );
}
