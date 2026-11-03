// Which voice engine/model handled a call, for the admin Monitoring cards.
// Pure (tested in scripts/tests/call-engine.test.ts).
//
// The events API strips this data for non-admins (supplier names never reach
// tenants), so this module holds NO supplier names either: display names are
// derived from the model id itself, so tenant bundles stay free of them.

export type CallEngine = {
  /** Provider id as sent by the worker ("openai" | "gemini" | "xai"). */
  provider: string;
  /** The real model id used for the call. */
  model: string;
  /** Where it was read from, most reliable first. */
  source: "engine" | "realtime_provider" | "usage";
};

type EventLike = { event: string; metadata?: Record<string, unknown> | null };

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Resolution order (agreed with tamaraVlad, 2026-11-03):
 * 1. `metadata.engine = { provider, model }` (call_started / call_metrics, new calls);
 * 2. the call's `realtime_provider` event `{ provider, model }` (calls since 2026-11-03 ~14:11Z);
 * 3. `call_metrics.metadata.usage.model`: older calls were all OpenAI and that
 *    field held the real OpenAI model;
 * 4. null, shown as "—". Never the tenant's CURRENT model: it may have changed
 *    since the call.
 */
export function resolveCallEngine(events: readonly EventLike[]): CallEngine | null {
  for (const e of events) {
    const engine = obj(obj(e.metadata)?.engine);
    const provider = str(engine?.provider);
    const model = str(engine?.model);
    if (provider && model) return { provider, model, source: "engine" };
  }
  for (const e of events) {
    if (e.event !== "realtime_provider") continue;
    const m = obj(e.metadata);
    const provider = str(m?.provider);
    const model = str(m?.model);
    if (provider && model) return { provider, model, source: "realtime_provider" };
  }
  for (const e of events) {
    const model = str(obj(obj(e.metadata)?.usage)?.model);
    if (model) return { provider: "openai", model, source: "usage" };
  }
  return null;
}

/**
 * "gpt-realtime-2.1" stays as is (OpenAI ids are what admins know);
 * "grok-voice-3.0" → "Grok Voice 3.0", "gemini-3.8-live" → "Gemini 3.8 Live".
 */
export function engineDisplayName(engine: Pick<CallEngine, "provider" | "model">): string {
  if (engine.provider === "openai" || engine.model.startsWith("gpt-")) return engine.model;
  return engine.model
    .split("-")
    .filter(Boolean)
    .map((part) => (/^[a-z]/.test(part) ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(" ");
}

/** "per_minute" when the cost is billed by the minute (no token counts). */
export function callPricing(events: readonly EventLike[]): "tokens" | "per_minute" | null {
  for (const e of events) {
    const p = str(obj(obj(e.metadata)?.usage)?.pricing);
    if (p === "tokens" || p === "per_minute") return p;
  }
  return null;
}
