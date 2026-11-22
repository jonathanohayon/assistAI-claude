// The served voice when an engine override APPLIES (E2). SERVER-SIDE, pure
// (imports the voice catalogue, which names engine voices: never tenant code).
// Called ONLY when engineForCall says `apply: true`; otherwise the handlers
// serve today's voice untouched.
//
// The voice follows the account to the forced engine through the existing
// equivalence table (voiceAfterEngineSwitch, the same rule as an admin
// engine switch): on Gemini / Grok the equivalent goes into
// advanced.voiceOverrides[engine] (served as voiceProfile.voiceOverrides), on
// OpenAI into voiceId (served as `voice`). The tenant still sees "Voix N".
// The model goes into advanced.model (served as `model`): the resolved OpenAI
// model, or the account's own value for Gemini / Grok (servedModel).

import type { EngineForCall } from "@/lib/engine-override";
import { voiceAfterEngineSwitch, voiceEngineOf } from "@/lib/voice/choice";
import type { Voice } from "@/lib/voice/contract";

export function voiceOnEngine(voice: Voice, d: Pick<EngineForCall, "engine" | "servedModel">): Voice {
  const from = voiceEngineOf(voice);
  const switched = from === d.engine ? voice : { ...voiceAfterEngineSwitch(voice, from, d.engine), engine: d.engine };
  return { ...switched, advanced: { ...switched.advanced, model: d.servedModel } };
}
