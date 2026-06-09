"use client";

import { useState } from "react";

/**
 * Bouton admin : déclare (ou retire) ce tenant comme compte démo de la page
 * d'accueil. L'agent démo de la home reprend alors sa persona/voix/accueil/
 * langue — personnalisable via le dashboard normal de ce compte.
 */
export function DemoAccountToggle({
  userId,
  initialIsDemo,
}: {
  userId: string;
  initialIsDemo: boolean;
}) {
  const [isDemo, setIsDemo] = useState(initialIsDemo);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/demo-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: isDemo ? null : userId }),
      });
      if (res.ok) setIsDemo((v) => !v);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title="Agent démo de la page d'accueil"
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
        isDemo
          ? "border-[#7c3aed] bg-[#7c3aed] text-white hover:opacity-90"
          : "border-[var(--color-border)] bg-white text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
      }`}
    >
      <span>{isDemo ? "★" : "☆"}</span>
      {isDemo ? "Compte démo (home)" : "Définir comme démo home"}
    </button>
  );
}
