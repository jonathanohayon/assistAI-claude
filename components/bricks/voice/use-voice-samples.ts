"use client";

import { useEffect, useSyncExternalStore } from "react";

import { getSamples, loadSamples, sampleFor, subscribeSamples } from "./voice-samples-store";

const SERVER = { byKey: new Map<string, string>(), loaded: false };

/** `(voiceId, style) → url | null` for the agent's language; re-renders on changes. */
export function useVoiceSample(language: string) {
  useSyncExternalStore(subscribeSamples, getSamples, () => SERVER);
  useEffect(() => {
    void loadSamples();
  }, []);
  return (voiceId: string, style: string) => sampleFor(voiceId, style, language);
}
