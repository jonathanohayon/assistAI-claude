// Speech-to-speech engine per tenant (agent_configs.realtime_provider).
// ADMIN-ONLY: set through PUT /api/admin/configs/:userId (or an admin's own
// /api/dashboard/config), never shown to or writable by tenants. NULL = OpenAI.
// Kept apart from lib/realtime.ts `Provider`, which is the browser
// WebRTC/WS transport for the landing demo and LiveTest.

export const REALTIME_PROVIDERS = ["openai", "gemini", "xai"] as const;
export type RealtimeProvider = (typeof REALTIME_PROVIDERS)[number];

/** Model each engine runs on the phone (the worker's defaults), for display. */
export const REALTIME_PROVIDER_MODEL: Record<RealtimeProvider, string> = {
  // OpenAI uses the tenant's own `model` (gpt-realtime-2 by default; the
  // admin can pick gpt-realtime-2.1, see ADMIN_ENGINE_OPTIONS).
  openai: "gpt-realtime-2",
  // https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live
  gemini: "gemini-3.8-live",
  // https://docs.x.ai/developers/model-capabilities/audio/voice-agent
  // (grok-voice-latest is an alias of grok-voice-3.0)
  xai: "grok-voice-3.0",
};

export type ProviderParse =
  | { ok: true; value: RealtimeProvider | null }
  | { ok: false; error: string };

/**
 * Validates an admin write. "openai" and null both store NULL (the default),
 * so switching back leaves no trace. Anything else is refused.
 */
export function parseRealtimeProvider(raw: unknown): ProviderParse {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "realtimeProvider must be a string" };
  const v = raw.trim().toLowerCase();
  if (v === "openai") return { ok: true, value: null };
  if ((REALTIME_PROVIDERS as readonly string[]).includes(v)) {
    return { ok: true, value: v as RealtimeProvider };
  }
  return {
    ok: false,
    error: `Unknown realtimeProvider: ${raw} (expected ${REALTIME_PROVIDERS.join(", ")})`,
  };
}

/** The value the worker receives: NULL / unknown -> "openai". */
export function effectiveRealtimeProvider(stored: string | null | undefined): RealtimeProvider {
  return stored === "gemini" || stored === "xai" ? stored : "openai";
}

/** Tenant-facing config: the admin-only field removed. */
export function withoutAdminOnlyFields<T extends Record<string, unknown>>(
  config: T,
): Omit<T, "realtimeProvider"> {
  const { realtimeProvider: _omit, ...rest } = config;
  void _omit;
  return rest;
}

/**
 * The realtimeProvider part of a /api/dashboard/config write. That route is
 * the tenant's own form, which may post the whole form JSON: for a tenant the
 * field is ignored silently (no error, nothing written), even if crafted by
 * hand; an admin on their own dashboard may set it.
 */
export function adminOnlyProviderUpdate(
  body: Record<string, unknown>,
  isAdmin: boolean,
): { update: { realtimeProvider?: RealtimeProvider | null } } | { error: string } {
  if (!isAdmin || !("realtimeProvider" in body)) return { update: {} };
  const rp = parseRealtimeProvider(body.realtimeProvider);
  return rp.ok ? { update: { realtimeProvider: rp.value } } : { error: rp.error };
}

/**
 * The admin picker's entries, as the (realtimeProvider, model) pair each one
 * writes through PUT /api/admin/configs/:userId. Tenants stay on the default
 * (gpt-realtime-2); the newer models exist only as admin options. `model:
 * undefined` = leave the tenant's OpenAI model untouched (it is unused while
 * another engine is selected, and comes back if the admin switches back).
 */
export const ADMIN_ENGINE_OPTIONS = [
  { id: "openai-2", label: "OpenAI gpt-realtime-2 (default)", realtimeProvider: null, model: "gpt-realtime-2" },
  { id: "openai-2.1", label: "OpenAI gpt-realtime-2.1", realtimeProvider: null, model: "gpt-realtime-2.1" },
  { id: "gemini", label: "Gemini 3.8 Live (experimental)", realtimeProvider: "gemini", model: undefined },
  { id: "xai", label: "Grok Voice 3.0 (no Hebrew)", realtimeProvider: "xai", model: undefined },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  realtimeProvider: RealtimeProvider | null;
  model: string | undefined;
}>;

export type AdminEngineOptionId = (typeof ADMIN_ENGINE_OPTIONS)[number]["id"];

/**
 * Which picker entry a tenant config corresponds to. "custom" = OpenAI with
 * a model set through the admin's raw model select (e.g. gpt-realtime-mini):
 * the picker must not present it as the default.
 */
export function currentEngineOption(config: {
  realtimeProvider?: string | null;
  model?: string | null;
}): AdminEngineOptionId | "custom" {
  const p = effectiveRealtimeProvider(config.realtimeProvider);
  if (p === "gemini" || p === "xai") return p;
  const model = config.model?.trim() || "gpt-realtime-2";
  if (model === "gpt-realtime-2") return "openai-2";
  if (model === "gpt-realtime-2.1") return "openai-2.1";
  return "custom";
}
