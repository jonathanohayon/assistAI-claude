"use client";

import { useEffect, useState } from "react";

import type { Provider } from "@/lib/realtime";

// Client-side hook : fetches the live OpenAI realtime catalog
// (/api/realtime/catalog) and exposes models + voices for picker UIs.
//
// No synchronous fallback: lib/realtime.ts (the provider catalogue) is never
// imported by client code (scripts/tests/realtime-client-safe.test.ts). Until
// the fetch completes, or if it fails, the catalog is empty; the route itself
// already answers with the hardcoded list when the live one is unavailable.
//
// Cached in sessionStorage for the page lifetime so repeated mounts don't
// retrigger the fetch. Server-side cache (1h) handles cross-user sharing.

interface CatalogModel {
  id: string;
  provider: Provider;
  live: boolean;
}

interface VoicesByProvider {
  provider: Provider;
  voices: string[];
  defaultVoice: string;
}

interface Catalog {
  models: CatalogModel[];
  voicesByProvider: Partial<Record<Provider, VoicesByProvider>>;
  source: "openai-api" | "fallback" | "loading";
}

const SESSION_CACHE_KEY = "realtime-catalog-v1";

// Empty until /api/realtime/catalog answers (same on server and client, so
// first paint hydrates cleanly).
function fallbackCatalog(): Catalog {
  return { models: [], voicesByProvider: {}, source: "loading" };
}

export function useRealtimeCatalog(): Catalog {
  // SSR-safe : on commence TOUJOURS par le fallback (server == client first
  // render), puis on hydrate depuis sessionStorage / réseau dans un useEffect.
  // Lire sessionStorage dans l'initializer de useState provoquait un mismatch
  // d'hydratation quand le cache contenait des voices différentes du fallback.
  const [catalog, setCatalog] = useState<Catalog>(fallbackCatalog);

  useEffect(() => {
    let cancelled = false;

    // 1. Tente d'hydrater depuis sessionStorage (instantané, sans flash réseau).
    try {
      const cached = sessionStorage.getItem(SESSION_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as Catalog;
        if (parsed?.models?.length > 0 && !cancelled) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- hydratation sessionStorage post-mount (SSR-safe), pattern voulu
          setCatalog(parsed);
        }
      }
    } catch {
      /* ignore broken cache */
    }

    // 2. Fetch frais en arrière-plan pour rafraîchir le cache.
    fetch("/api/realtime/catalog")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const next: Catalog = {
          models: data.models,
          voicesByProvider: Object.fromEntries(
            (data.voices as VoicesByProvider[]).map((v) => [v.provider, v]),
          ) as Partial<Record<Provider, VoicesByProvider>>,
          source: data.source,
        };
        setCatalog(next);
        try {
          sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(next));
        } catch {
          /* quota / disabled */
        }
      })
      .catch(() => {
        /* keep fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return catalog;
}
