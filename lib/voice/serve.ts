// `voice` as served to the worker by the three config routes. SERVER-SAFE,
// pure. The served voice is self-sufficient: it always names the model, so
// the worker never needs the legacy fields once worker V2 is live.
// Until then the routes ALSO keep serving the legacy fields (realtimeProvider,
// model, voice, speed, noiseReductionLevel, voiceProfile) unchanged, so the
// worker live today behaves exactly as before.

import { fromInboundColumns, fromOutboundColumns, type InboundVoiceColumns, type OutboundVoiceColumns } from "@/lib/voice/adapters";
import type { Voice } from "@/lib/voice/contract";

/** Model of outbound calls (not stored per agent): same env rule as today. */
export function outboundModel(): string {
  return process.env.REALTIME_MODEL || "gpt-realtime";
}

export function servedInboundVoice(row: InboundVoiceColumns, defaultModel: string): Voice {
  const v = fromInboundColumns(row);
  return { ...v, advanced: { ...v.advanced, model: v.advanced.model ?? defaultModel } };
}

export function servedOutboundVoice(row: OutboundVoiceColumns): Voice {
  const v = fromOutboundColumns(row);
  return { ...v, advanced: { ...v.advanced, model: outboundModel() } };
}
