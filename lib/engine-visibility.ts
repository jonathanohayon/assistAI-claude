// Which speech engine / AI supplier handled a call is ADMIN-ONLY (same rule as
// the engine picker). Monitoring builds its cards client-side from raw event
// metadata, so for a tenant the server must remove every supplier trace
// before sending: a UI-only gate would still leak it in the JSON.
// Unit-tested in scripts/tests/engine-visibility.test.ts.

/** Events whose name or message reveals the engine or supplier. */
export const ADMIN_ONLY_EVENTS = new Set([
  "realtime_provider", // "Realtime provider: xai"
  "provider_key_missing",
  "provider_language_warning",
  "config_loaded", // "Config chargée : <model> / <voice>"
  "openai_usage",
  "realtime_fatal_error", // "OpenAI Realtime fatal…", "Gemini Live fatal…"
  "realtime_server_warning",
  "realtime_server_error",
  "realtime_zombie_detected",
  "realtime_session_shutdown",
  "gemini_silent_gen",
  "infra_region_probe", // names OpenAI Realtime
]);

type Meta = Record<string, unknown> | null | undefined;

/** Metadata with engine, model and supplier topology removed. */
export function stripEngineFromMetadata(metadata: Meta): Meta {
  if (!metadata || typeof metadata !== "object") return metadata;
  const { engine: _e, model: _m, topology: _t, ...rest } = metadata as Record<string, unknown>;
  void _e;
  void _m;
  void _t;
  const usage = rest.usage;
  if (usage && typeof usage === "object") {
    const { model: _um, provider: _up, ...u } = usage as Record<string, unknown>;
    void _um;
    void _up;
    rest.usage = u;
  }
  return rest;
}

/** The events list as a tenant may see it (admins see everything). */
export function eventsForViewer<E extends { event: string; metadata: unknown }>(
  rows: E[],
  isAdmin: boolean,
): E[] {
  if (isAdmin) return rows;
  return rows
    .filter((r) => !ADMIN_ONLY_EVENTS.has(r.event))
    .map((r) => ({ ...r, metadata: stripEngineFromMetadata(r.metadata as Meta) }));
}
