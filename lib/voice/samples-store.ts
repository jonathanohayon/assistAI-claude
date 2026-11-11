// Voice samples (V7) — SERVER-ONLY: storage + rendering (default engine;
// Gemini / Grok voices by our catalogue id since V8c).

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { voiceSamples } from "@/lib/db/schema";
import { renderOpenerAudio } from "@/lib/greeting-render";
import { VOICE_STYLE_PRESETS } from "@/lib/voice/contract";
import { engineSamplePlan, renderEngineSample, type SampleEngine } from "@/lib/voice/engine-samples";
import { SAMPLE_TEXT, samplePlan, VOICE_SAMPLE_VERSION, type SampleKey } from "@/lib/voice/samples";

/** How the default engine is asked to read a sample: the style's own tuning. */
export function sampleRendering(k: SampleKey): { text: string; tone?: string; speed?: number } {
  const p = VOICE_STYLE_PRESETS[k.style].openai;
  return {
    text: SAMPLE_TEXT[k.language],
    ...(p.instruction ? { tone: p.instruction } : {}),
    ...(p.speedFactor !== 1 ? { speed: p.speedFactor } : {}),
  };
}

/** Model used to render samples: the default engine's default model. */
const SAMPLE_MODEL = "gpt-realtime-2";

export async function availableSampleKeys(): Promise<Array<SampleKey & { createdAt: Date }>> {
  const rows = await db
    .select({
      voiceId: voiceSamples.voiceId,
      style: voiceSamples.style,
      language: voiceSamples.language,
      createdAt: voiceSamples.createdAt,
    })
    .from(voiceSamples)
    .where(eq(voiceSamples.version, VOICE_SAMPLE_VERSION));
  return rows as Array<SampleKey & { createdAt: Date }>;
}

export async function getSample(k: SampleKey) {
  const [row] = await db
    .select({ audioPcm: voiceSamples.audioPcm, sampleRate: voiceSamples.sampleRate })
    .from(voiceSamples)
    .where(
      and(
        eq(voiceSamples.voiceId, k.voiceId),
        eq(voiceSamples.style, k.style),
        eq(voiceSamples.language, k.language),
        eq(voiceSamples.version, VOICE_SAMPLE_VERSION),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface GenerateResult {
  generated: number;
  failed: Array<SampleKey & { error: string }>;
  remaining: number;
}

/** Renders up to `limit` missing samples (idempotent; safe to call repeatedly). */
export async function generateMissingSamples(
  limit: number,
  render: typeof renderOpenerAudio = renderOpenerAudio,
): Promise<GenerateResult> {
  return generateMissing(samplePlan(), limit, (k) => render({ ...sampleRendering(k), voice: k.voiceId, model: SAMPLE_MODEL }));
}

/** Same, for the Gemini / Grok voices (keyed by our catalogue id, V8c). */
export async function generateMissingEngineSamples(
  engine: SampleEngine,
  limit: number,
  render: (k: SampleKey) => Promise<{ pcm: Buffer; sampleRate: number }> = renderEngineSample,
): Promise<GenerateResult> {
  return generateMissing(engineSamplePlan(engine), limit, render);
}

async function generateMissing(
  plan: SampleKey[],
  limit: number,
  render: (k: SampleKey) => Promise<{ pcm: Buffer; sampleRate: number }>,
): Promise<GenerateResult> {
  const have = new Set((await availableSampleKeys()).map((k) => `${k.voiceId}/${k.style}/${k.language}`));
  const missing = plan.filter((k) => !have.has(`${k.voiceId}/${k.style}/${k.language}`));
  const batch = missing.slice(0, Math.max(0, limit));
  const result: GenerateResult = { generated: 0, failed: [], remaining: missing.length - batch.length };
  for (const k of batch) {
    try {
      const audio = await render(k);
      await db
        .insert(voiceSamples)
        .values({ ...k, version: VOICE_SAMPLE_VERSION, audioPcm: audio.pcm, sampleRate: audio.sampleRate })
        .onConflictDoNothing();
      result.generated++;
    } catch (e) {
      result.failed.push({ ...k, error: (e as Error).message.slice(0, 200) });
      result.remaining++;
    }
  }
  return result;
}
