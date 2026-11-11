// Server side of the tenant voice choice (V8c): the view plus the sample
// URLs, for GET/PUT /api/dashboard/config, the admin config and the
// server-rendered dashboard pages. Returns only tenant-safe data.
import { effectiveRealtimeProvider } from "@/lib/realtime-provider";
import { tenantVoiceChoice, type TenantVoiceChoice } from "@/lib/voice/choice";
import type { InboundVoiceColumns } from "@/lib/voice/adapters";
import { SAMPLE_LANGUAGES, sampleVisible, versionedSampleUrl, type SampleLanguage } from "@/lib/voice/samples";
import { availableSampleKeys } from "@/lib/voice/samples-store";
import { currentInboundVoice } from "@/lib/voice/store";

export async function voiceChoiceFor(
  row: InboundVoiceColumns & { voiceConfig: unknown; primaryLanguage: string | null },
  isAdmin: boolean,
): Promise<TenantVoiceChoice> {
  const voice = currentInboundVoice(row.voiceConfig, row);
  const engine = effectiveRealtimeProvider(row.realtimeProvider);
  const language: SampleLanguage = (SAMPLE_LANGUAGES as readonly string[]).includes(row.primaryLanguage ?? "")
    ? (row.primaryLanguage as SampleLanguage)
    : "fr";
  // The agent's style when the viewer can hear it, else today's "warm".
  const style = sampleVisible({ style: voice.style }, isAdmin) ? voice.style : "warm";
  const samples = await availableSampleKeys();
  return tenantVoiceChoice(voice, engine, (v) => {
    // OpenAI recordings are keyed by voice name, Gemini / Grok ones by our id.
    const key = v.engine === "openai" ? v.name : v.id;
    const k = samples.find((x) => x.voiceId === key && x.style === style && x.language === language);
    return k ? versionedSampleUrl(k, k.createdAt) : null;
  });
}
