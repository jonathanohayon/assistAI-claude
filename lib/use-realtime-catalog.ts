"use client";

import { useEffect, useState } from "react";

import {
  PROVIDERS,
  REALTIME_MODELS as FALLBACK_MODELS,
  type Provider,
} from "@/lib/realtime";

// Client-side hook : fetches the live OpenAI realtime catalog
// (/api/realtime/catalog) and exposes models + voices for picker UIs.
//
// Falls back to the hardcoded list (lib/realtime.ts) when:
//   - the fetch hasn't completed yet (during SSR or before mount)
//   - the API returned `source: "fallback"` (OpenAI down / no key)
//   - the network call fails
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
  voicesByProvider: Record<Provider, VoicesByProvider>;
  source: "openai-api" | "fallback" | "loading";
}

const SESSION_CACHE_KEY = "realtime-catalog-v1";

// Synchronous fallback derived from the hardcoded lib/realtime.ts data, used
// before the network fetch completes. This keeps SSR / first paint correct.
function fallbackCatalog(): Catalog {
  return {
    models: FALLBACK_MODELS.map((m) => ({ ...m, live: false })),
    voicesByProvider: {
      openai: {
        provider: "openai",
        voices: [...PROVIDERS.openai.voices],
        defaultVoice: PROVIDERS.openai.defaultVoice,
      },
      xai: {
        provider: "xai",
        voices: [...PROVIDERS.xai.voices],
        defaultVoice: PROVIDERS.xai.defaultVoice,
      },
    },
    source: "loading",
  };
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
          ) as Record<Provider, VoicesByProvider>,
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

export function providerForCatalog(
  catalog: Catalog,
  modelId: string,
): Provider {
  return catalog.models.find((m) => m.id === modelId)?.provider ?? "openai";
}

export function voicesForCatalog(
  catalog: Catalog,
  modelId: string,
): readonly string[] {
  return catalog.voicesByProvider[providerForCatalog(catalog, modelId)].voices;
}

export function defaultVoiceForCatalog(
  catalog: Catalog,
  modelId: string,
): string {
  return catalog.voicesByProvider[providerForCatalog(catalog, modelId)]
    .defaultVoice;
}
