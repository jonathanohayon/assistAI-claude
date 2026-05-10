import { NextResponse } from "next/server";

import { PROVIDERS, REALTIME_MODELS as FALLBACK_MODELS } from "@/lib/realtime";

// Returns the list of realtime models + voices the dashboard pickers should
// show. Models are fetched LIVE from OpenAI's /v1/models endpoint and
// filtered for "realtime" — no more hardcoding catch-up. Voices are NOT
// exposed by OpenAI as a REST endpoint, so we still serve a curated list
// from lib/realtime.ts (single source of truth: update PROVIDERS.openai.voices
// when OpenAI ships a new voice).
//
// Cached 1 hour in process memory to avoid spamming OpenAI on every page
// load. Cold-start refresh on Railway is fine — the catalog rarely changes.

export interface CatalogModel {
  id: string;
  provider: "openai" | "xai";
  /** Whether this model came from the live OpenAI API (true) or the
   *  hardcoded fallback (false — API failed/unauthenticated). */
  live: boolean;
}

export interface CatalogResponse {
  models: CatalogModel[];
  voices: { provider: "openai" | "xai"; voices: string[]; defaultVoice: string }[];
  source: "openai-api" | "fallback";
  cachedAt: string;
  refreshedInMs: number | null;
}

interface CacheEntry {
  payload: CatalogResponse;
  expiresAt: number;
}
let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;

interface OpenAIModelListItem {
  id: string;
  object: string;
}

async function fetchOpenAIRealtimeModels(): Promise<string[] | null> {
  const apiKey = PROVIDERS.openai.apiKey;
  const baseUrl = PROVIDERS.openai.baseUrl;
  if (!apiKey) return null;
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn(
        `[catalog] OpenAI /v1/models → ${res.status}, falling back to hardcoded list`,
      );
      return null;
    }
    const data = (await res.json()) as { data?: OpenAIModelListItem[] };
    const ids = (data.data ?? [])
      .map((m) => m.id)
      // Realtime-eligible models: ids containing "realtime" in any form.
      .filter((id) => /realtime/i.test(id))
      // Sort: aliases first (no date suffix), then dated snapshots reverse-chrono.
      .sort((a, b) => {
        const aDated = /\d{4}-\d{2}-\d{2}/.test(a);
        const bDated = /\d{4}-\d{2}-\d{2}/.test(b);
        if (aDated !== bDated) return aDated ? 1 : -1;
        return b.localeCompare(a);
      });
    return ids;
  } catch (e) {
    console.warn(
      `[catalog] OpenAI /v1/models fetch threw: ${(e as Error).message}`,
    );
    return null;
  }
}

export async function GET() {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return NextResponse.json({
      ...cache.payload,
      // Surface remaining TTL so clients can debug stale catalogs.
      cachedAgeMs: now - new Date(cache.payload.cachedAt).getTime(),
    });
  }

  const startedAt = Date.now();
  const liveOpenAi = await fetchOpenAIRealtimeModels();

  const openaiModels: CatalogModel[] = liveOpenAi
    ? liveOpenAi.map((id) => ({ id, provider: "openai" as const, live: true }))
    : FALLBACK_MODELS.filter((m) => m.provider === "openai").map((m) => ({
        id: m.id,
        provider: "openai" as const,
        live: false,
      }));

  // xAI : pas d'endpoint public pour lister les modèles realtime — fallback only.
  const xaiModels: CatalogModel[] = FALLBACK_MODELS.filter(
    (m) => m.provider === "xai",
  ).map((m) => ({ id: m.id, provider: "xai" as const, live: false }));

  const payload: CatalogResponse = {
    models: [...openaiModels, ...xaiModels],
    voices: [
      {
        provider: "openai",
        voices: [...PROVIDERS.openai.voices],
        defaultVoice: PROVIDERS.openai.defaultVoice,
      },
      {
        provider: "xai",
        voices: [...PROVIDERS.xai.voices],
        defaultVoice: PROVIDERS.xai.defaultVoice,
      },
    ],
    source: liveOpenAi ? "openai-api" : "fallback",
    cachedAt: new Date().toISOString(),
    refreshedInMs: Date.now() - startedAt,
  };

  cache = { payload, expiresAt: now + CACHE_TTL_MS };
  return NextResponse.json(payload);
}
