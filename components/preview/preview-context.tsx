"use client";

/**
 * Preview mode (F2), as a context: a product the account does not own shows
 * its real screen, read-only, over sample data.
 *
 *   - useDataFetch(): the `fetch` a screen must use for its data. Outside a
 *     preview it is the browser's fetch (looked up at call time); inside, the
 *     sample source (lib/preview-fetch.ts), in memory: no request leaves the
 *     page. The value is stable, so it is safe in effect dependencies.
 *   - useIsPreview(): true inside a preview; the screen disables its inputs
 *     and hides or disables its writes.
 *
 * Owned pages never mount the provider: their behaviour is unchanged.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { previewFetcher } from "@/lib/preview-fetch";

type PreviewValue = { fetch: typeof fetch };

const PreviewContext = createContext<PreviewValue | null>(null);

// Module-level, so its identity never changes between renders.
const browserFetch: typeof fetch = (input, init) => fetch(input, init);

export function useDataFetch(): typeof fetch {
  return useContext(PreviewContext)?.fetch ?? browserFetch;
}

export function useIsPreview(): boolean {
  return useContext(PreviewContext) !== null;
}

/** Wraps a real screen in preview mode, fed by the sample source in `lang`. */
export function PreviewProvider({ lang, children }: { lang: string; children: ReactNode }) {
  const value = useMemo(() => ({ fetch: previewFetcher(lang) }), [lang]);
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}
