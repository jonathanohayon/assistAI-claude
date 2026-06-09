// Mapping voix/personnalité partagé entre l'UI (sliders 1-10) et les valeurs
// API OpenAI Realtime réelles. Aligné sur la config entrante (config-form.tsx)
// pour que les agents sortants se règlent EXACTEMENT comme l'agent entrant.
// CLIENT-SAFE (pas d'I/O).

export type Gender = "f" | "m";

// Genre par défaut de chaque voix OpenAI Realtime (rose = F, cyan = M).
export const VOICE_GENDER: Record<string, Gender> = {
  marin: "f",
  ballad: "m",
  sage: "f",
  verse: "m",
  alloy: "m",
  shimmer: "f",
  echo: "m",
  fable: "m",
  onyx: "m",
  nova: "f",
  coral: "f",
  ash: "m",
};

// UI 1-10 ↔ API. Speed 0.5..1.5 (5 = 1.0×). Temperature 0..1.5.
export const speedFromUI = (ui: number) => 0.5 + ((ui - 1) / 9) * 1.0;
export const uiFromSpeed = (api: number) => Math.round(((api - 0.5) / 1.0) * 9 + 1);
export const tempFromUI = (ui: number) => ((ui - 1) / 9) * 1.5;
export const uiFromTemp = (api: number) => Math.round((api / 1.5) * 9 + 1);
export const clamp10 = (n: number) => Math.min(10, Math.max(1, Math.round(n)));

export type AgentPersonality = {
  vitesse?: number;
  creativite?: number;
  reactivite?: number;
};

// Personnalité (UI 1-10) → paramètres runtime servis au worker. `reactivite`
// est passée telle quelle (le worker la convertit en silence_duration_ms VAD).
export function personalityToRealtime(
  p: AgentPersonality | null | undefined,
  noiseReductionLevel: number | null | undefined,
): { speed: number; temperature: number; reactivite: number; noiseReductionLevel: number } {
  const vitesse = clamp10(p?.vitesse ?? 5);
  const creativite = clamp10(p?.creativite ?? 5);
  const reactivite = clamp10(p?.reactivite ?? 5);
  const nrl = Math.min(10, Math.max(1, Math.round(noiseReductionLevel ?? 8)));
  return {
    speed: Number(speedFromUI(vitesse).toFixed(3)),
    temperature: Number(tempFromUI(creativite).toFixed(3)),
    reactivite,
    noiseReductionLevel: nrl,
  };
}
