// Voice samples (V7) for the Listen button — browser side. One shared list
// per page: GET /api/voice/samples → { samples: [{ voiceId, style, language,
// url }] }, ONLY the samples that exist (tenants: "warm" only). Listen shows
// only for a listed (voice, style, language); a 404 on play hides it.

export interface VoiceSampleRow {
  voiceId: string;
  style: string;
  language: string;
  url: string;
}

type Listener = () => void;
type Fetch = typeof fetch;

interface State {
  byKey: ReadonlyMap<string, string>;
  loaded: boolean;
}

let state: State = { byKey: new Map(), loaded: false };
let loading: Promise<void> | null = null;
const listeners = new Set<Listener>();
const missing = new Set<string>();

export const sampleKey = (voiceId: string, style: string, language: string) => `${voiceId}/${style}/${language}`;

const emit = () => listeners.forEach((l) => l());

export function getSamples(): State {
  return state;
}

export function subscribeSamples(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Loads the list once (shared); `force` reloads (after a generation run). */
export function loadSamples(f: Fetch = fetch, force = false): Promise<void> {
  if (!force && (state.loaded || loading)) return loading ?? Promise.resolve();
  loading = (async () => {
    try {
      const res = await f("/api/voice/samples", { cache: "no-store" });
      const body = res.ok ? ((await res.json()) as { samples?: VoiceSampleRow[] }) : { samples: [] };
      const byKey = new Map<string, string>();
      for (const s of body.samples ?? []) byKey.set(sampleKey(s.voiceId, s.style, s.language), s.url);
      state = { byKey, loaded: true };
    } catch {
      // No list → no Listen button; the screen works the same.
      state = { byKey: new Map(), loaded: true };
    } finally {
      loading = null;
      emit();
    }
  })();
  return loading;
}

/** URL to play, or null when no such sample exists (or it 404'd). */
export function sampleFor(voiceId: string, style: string, language: string): string | null {
  const url = state.byKey.get(sampleKey(voiceId, style, language)) ?? null;
  return url && !missing.has(url) ? url : null;
}

/** The audio 404'd (deleted since the list was read): hide the button. */
export function markSampleMissing(url: string) {
  missing.add(url);
  emit();
}

/** Test-only. */
export function __resetSamples() {
  state = { byKey: new Map(), loaded: false };
  loading = null;
  missing.clear();
}
