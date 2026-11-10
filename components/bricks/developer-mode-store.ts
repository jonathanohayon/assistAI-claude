// Account-level "developer mode" flag (shared primitive for every brick).
// A display preference: off by default, any tenant can turn it on. It never
// grants anything: supplier fields (engine, model…) stay role-gated.
//
// One store per account (key = asUserId or "me"), so the switch in account
// settings and every brick on the page stay in sync without a refetch.
// API (web, tamaraVlad): GET/PUT /api/dashboard/account[?asUserId=]
//   → { developerMode: boolean }; PUT non-boolean → 400 invalid_developer_mode.

export interface DeveloperModeState {
  /** null until the first load finishes. */
  enabled: boolean | null;
  saving: boolean;
  error: "load" | "save" | null;
}

type Listener = () => void;
type Fetch = typeof fetch;

interface Entry {
  state: DeveloperModeState;
  listeners: Set<Listener>;
  loading: Promise<void> | null;
  /** Bumped on every save: only the latest save may confirm or roll back. */
  seq: number;
  /** Last value the server confirmed (the rollback target). */
  confirmed: boolean | null;
}

const entries = new Map<string, Entry>();

const keyOf = (asUserId?: string | null) => asUserId || "me";
const urlOf = (asUserId?: string | null) =>
  `/api/dashboard/account${asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : ""}`;

function entry(key: string): Entry {
  let e = entries.get(key);
  if (!e) {
    e = { state: { enabled: null, saving: false, error: null }, listeners: new Set(), loading: null, seq: 0, confirmed: null };
    entries.set(key, e);
  }
  return e;
}

function set(key: string, patch: Partial<DeveloperModeState>) {
  const e = entry(key);
  e.state = { ...e.state, ...patch };
  e.listeners.forEach((l) => l());
}

export function getDeveloperMode(asUserId?: string | null): DeveloperModeState {
  return entry(keyOf(asUserId)).state;
}

export function subscribeDeveloperMode(asUserId: string | null | undefined, l: Listener): () => void {
  const e = entry(keyOf(asUserId));
  e.listeners.add(l);
  return () => e.listeners.delete(l);
}

/** Loads the flag once per account (concurrent callers share the request). */
export function loadDeveloperMode(asUserId?: string | null, f: Fetch = fetch): Promise<void> {
  const key = keyOf(asUserId);
  const e = entry(key);
  // Loaded already → no refetch, unless that load failed (then retry).
  if (e.state.enabled !== null && e.state.error !== "load") return Promise.resolve();
  if (e.loading) return e.loading;
  e.loading = (async () => {
    try {
      const res = await f(urlOf(asUserId), { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { developerMode?: unknown };
      e.confirmed = body.developerMode === true;
      set(key, { enabled: e.confirmed, error: null });
    } catch {
      // Off is the safe default: advanced fields simply stay hidden.
      set(key, { enabled: false, error: "load" });
    } finally {
      e.loading = null;
    }
  })();
  return e.loading;
}

/** Optimistic update; rolls back and flags the error if the save fails. */
export async function setDeveloperMode(
  asUserId: string | null | undefined,
  enabled: boolean,
  f: Fetch = fetch,
): Promise<boolean> {
  const key = keyOf(asUserId);
  const e = entry(key);
  const seq = ++e.seq;
  set(key, { enabled, saving: true, error: null });
  try {
    const res = await f(urlOf(asUserId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ developerMode: enabled }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { developerMode?: unknown };
    e.confirmed = body.developerMode === true;
    // A newer save started meanwhile: its own outcome decides the display.
    if (seq === e.seq) set(key, { enabled: e.confirmed, saving: false });
    return true;
  } catch {
    if (seq === e.seq) set(key, { enabled: e.confirmed ?? false, saving: false, error: "save" });
    return false;
  }
}

/** Test-only: forget every account. */
export function __resetDeveloperModeStore() {
  entries.clear();
}
