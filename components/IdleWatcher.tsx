"use client";

import { useEffect, useRef, useState } from "react";

// Idle-logout client-side. Surveille l'activité utilisateur (mouse, clavier,
// scroll, touch). Au-delà de `timeoutMs` sans interaction, déclenche un
// signOut() et redirige vers la page d'accueil. Affiche un dialog d'alerte
// 60s avant l'expiration pour laisser une chance de relancer l'activité.
//
// La couche serveur (auth.ts session.maxAge = 1h) couvre déjà le cas où le
// user est INACTIVE entre les requests (la session JWT expire). Ce timer
// client complète : si l'onglet reste ouvert sans interaction (pas de
// request fetch), le serveur n'a aucune trace d'activité → ce composant
// déclenche le logout côté UI.

const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1h
const WARNING_BEFORE_MS = 60 * 1000; // 60s avant le timeout
const ACTIVITY_EVENTS = [
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "visibilitychange",
] as const;

export function IdleWatcher() {
  // Initialisé sur le client au montage (cf. effet tick) — pas d'appel impur
  // (Date.now()) pendant le render.
  const lastActivityRef = useRef<number>(0);
  const [warningOpen, setWarningOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(WARNING_BEFORE_MS / 1000);

  useEffect(() => {
    const reset = () => {
      lastActivityRef.current = Date.now();
      if (warningOpen) setWarningOpen(false);
    };
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, reset, { passive: true });
    }
    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, reset);
      }
    };
  }, [warningOpen]);

  // Tick chaque seconde. Suffisamment précis pour un timeout 1h et léger.
  useEffect(() => {
    // Init au montage côté client (évite Date.now() pendant le render).
    lastActivityRef.current = Date.now();
    const id = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= IDLE_TIMEOUT_MS) {
        // Timeout atteint → logout. signOut via le endpoint NextAuth.
        // POST direct au lieu d'importer next-auth/react pour éviter une
        // dep côté client lourde si pas déjà bundlée. Redirige vers la page
        // d'accueil (et pas /login) à l'expiration de session.
        fetch("/api/admin/auth/signout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }).finally(() => {
          window.location.href = "/";
        });
        return;
      }
      const remainingMs = IDLE_TIMEOUT_MS - idleMs;
      if (remainingMs <= WARNING_BEFORE_MS) {
        setWarningOpen(true);
        setSecondsLeft(Math.ceil(remainingMs / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  if (!warningOpen) return null;

  return (
    <div
      role="alertdialog"
      aria-labelledby="idle-warning-title"
      className="fixed inset-x-0 bottom-4 z-[60] mx-auto w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-amber-200 bg-white shadow-xl"
    >
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          ⏰
        </div>
        <div className="flex-1">
          <p
            id="idle-warning-title"
            className="text-sm font-semibold text-[var(--color-foreground)]"
          >
            Vous serez déconnecté dans {secondsLeft}s
          </p>
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
            Aucune activité détectée depuis presque 1h. Bougez la souris ou
            cliquez pour rester connecté.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                lastActivityRef.current = Date.now();
                setWarningOpen(false);
              }}
              className="rounded-full bg-[var(--color-foreground)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-primary)]"
            >
              Rester connecté
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/api/admin/auth/signout";
              }}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              Se déconnecter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
