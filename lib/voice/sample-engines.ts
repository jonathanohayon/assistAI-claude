// Admin status of the sample renderers per engine (V8c): is the key the
// render path reads set, under which env var NAME, and how many samples are
// ready. SERVER-ONLY. NEVER a key value — booleans and variable names only.
import { engineSamplePlan } from "@/lib/voice/engine-samples";
import { samplePlan, type SampleKey } from "@/lib/voice/samples";

export type SampleRenderEngine = "openai" | "gemini" | "xai";

/** Environment variables as read (process.env, or a plain record in tests). */
export type EnvVars = Record<string, string | undefined>;
export const SAMPLE_RENDER_ENGINES: readonly SampleRenderEngine[] = ["openai", "gemini", "xai"];

/**
 * The variables each render path reads, in its order (the first one set
 * wins): lib/greeting-render.ts (OpenAI), lib/voice/engine-tts.ts (Gemini, Grok).
 */
const KEY_ENV: Record<SampleRenderEngine, readonly string[]> = {
  openai: ["OPENAI_API_KEY"],
  gemini: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  xai: ["XAI_API_KEY"],
};

export interface EngineSampleStatus {
  keySet: boolean;
  /** The variable to set (or the one in use). A NAME, never a value. */
  env: string;
  ready: number;
  total: number;
}

export function sampleKeyStatus(engine: SampleRenderEngine, env: EnvVars = process.env): { keySet: boolean; env: string } {
  const names = KEY_ENV[engine];
  const set = names.find((n) => (env[n] ?? "").trim().length > 0);
  return { keySet: Boolean(set), env: set ?? names[0] };
}

export function enginePlan(engine: SampleRenderEngine): SampleKey[] {
  return engine === "openai" ? samplePlan() : engineSamplePlan(engine);
}

export function sampleEngineStatus(
  available: ReadonlyArray<Pick<SampleKey, "voiceId" | "style" | "language">>,
  env: EnvVars = process.env,
): Record<SampleRenderEngine, EngineSampleStatus> {
  const have = new Set(available.map((k) => `${k.voiceId}/${k.style}/${k.language}`));
  const out = {} as Record<SampleRenderEngine, EngineSampleStatus>;
  for (const e of SAMPLE_RENDER_ENGINES) {
    const plan = enginePlan(e);
    out[e] = { ...sampleKeyStatus(e, env), ready: plan.filter((k) => have.has(`${k.voiceId}/${k.style}/${k.language}`)).length, total: plan.length };
  }
  return out;
}
