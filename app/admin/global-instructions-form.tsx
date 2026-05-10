"use client";

import { useState, useTransition } from "react";

const PLACEHOLDER = `# Règles transverses appliquées à tous les tenants

Ton :
- Empathique et chaleureuse
- Réponses courtes (1-2 phrases max)

Anti-silence :
Avant d'appeler un tool, dire à voix haute "Je consulte tout ça, deux secondes...".

…etc.`;

export function GlobalInstructionsForm({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ globalInstructions: text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Erreur");
        return;
      }
      setSavedAt(new Date().toLocaleTimeString("fr-FR"));
      setDirty(false);
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-sm sm:p-8"
    >
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        rows={18}
        placeholder={PLACEHOLDER}
        className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
      />

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="text-xs">
          {error ? (
            <span className="font-medium text-[var(--color-destructive)]">
              {error}
            </span>
          ) : dirty ? (
            <span className="text-[var(--color-warning)]">
              Modifications non sauvegardées
            </span>
          ) : savedAt ? (
            <span className="text-[var(--color-success)]">
              Sauvegardé à {savedAt} · Appliqué dès le prochain appel
            </span>
          ) : (
            <span className="text-[var(--color-muted-foreground)]">
              {text.length} caractères · préfixés au persona de chaque tenant
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={isPending || !dirty}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white shadow-md disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Sauvegarde…" : "Sauvegarder"}
        </button>
      </div>
    </form>
  );
}
