// What the home's Features mocks show: real settings of the dashboard, read
// from the dashboard's OWN message keys (VoiceBrick, PersonaBrick) at their
// product defaults, so the mock can't promise a setting that doesn't exist
// or drift from its wording. scripts/tests/feature-mock-settings.test.ts
// checks every key is one the tile reads and every range/default is the
// tile's. Server-side only (FeatureBentoSection): the dashboard namespaces
// are not shipped to public pages, only the resolved strings.

import { CLIENT_DEFAULT_VOICE, VOICE_PACES } from "@/components/bricks/voice/voice-client";
import { paceFill, patienceToScreen } from "@/components/bricks/voice/voice-ui";

/** One slider of the Voice tile, as the mock draws it. */
export type MockSlider = {
  id: "pace" | "patience" | "noise";
  label: string;
  /** Word shown at the end of the label row (the tile shows the pace in words). */
  value: string | null;
  minLabel: string;
  midLabel: string | null;
  maxLabel: string;
  /** Thumb position, 0–100 % from the inline start. */
  at: number;
  /** Fill, from the inline start: [start %, width %]. */
  fill: [number, number];
};
export type MockSwitch = { id: string; label: string; on: boolean };
export type FeatureMockLabels = { sliders: MockSlider[]; switches: MockSwitch[] };

// The Voice tile's sliders (components/bricks/voice/VoiceBrick.tsx): keys in
// the VoiceBrick namespace, ranges as the tile's <Slider min max>.
export const VOICE_MOCK_KEYS = {
  pace: { label: "paceLabel", min: "pace.very_slow", mid: "pace.normal", max: "pace.very_fast" },
  patience: { label: "patienceLabel", min: "patienceMin", max: "patienceMax" },
  noise: { label: "noiseLabel", min: "noiseMin", max: "noiseMax" },
} as const;
export const PATIENCE_RANGE = { min: 1, max: 5 } as const;
export const NOISE_RANGE = { min: 1, max: 10 } as const;

// The "Configuration live" card: three switches of the product, with their
// defaults. [namespace, key, default].
export const CONFIG_MOCK_SWITCHES = [
  // Voice tile: ToggleRow bargeIn (CLIENT_DEFAULT_VOICE.bargeIn).
  { id: "bargeIn", ns: "VoiceBrick", key: "bargeInLabel" },
  // Voice tile: ToggleRow languageLock (CLIENT_DEFAULT_VOICE.languageLock).
  { id: "languageLock", ns: "VoiceBrick", key: "languageLockLabel" },
  // Personality tile: ToggleRow AI disclosure (users.ai_disclosure_enabled, default true).
  { id: "aiDisclosure", ns: "PersonaBrick", key: "disclosureLabel" },
] as const;
export const AI_DISCLOSURE_DEFAULT = true;

const pct = (v: number, min: number, max: number) => ((v - min) / (max - min)) * 100;
const num = (s: string) => Number.parseFloat(s);

type T = (key: string) => string;

/** The mock's labels and positions, from the two dashboard translators. */
export function featureMockLabels(voice: T, persona: T): FeatureMockLabels {
  const d = CLIENT_DEFAULT_VOICE;
  const paceIndex = VOICE_PACES.indexOf(d.pace);
  const paceFillStyle = paceFill(paceIndex, VOICE_PACES.length);
  const patience = patienceToScreen(d.patience);
  const k = VOICE_MOCK_KEYS;
  const sliders: MockSlider[] = [
    {
      id: "pace",
      label: voice(k.pace.label),
      value: voice(`pace.${d.pace}`),
      minLabel: voice(k.pace.min),
      midLabel: voice(k.pace.mid),
      maxLabel: voice(k.pace.max),
      at: pct(paceIndex, 0, VOICE_PACES.length - 1),
      // The tile fills from the centre mark to the thumb: empty at Normal.
      fill: [num(paceFillStyle.insetInlineStart), num(paceFillStyle.width)],
    },
    {
      id: "patience",
      label: voice(k.patience.label),
      value: null,
      minLabel: voice(k.patience.min),
      midLabel: null,
      maxLabel: voice(k.patience.max),
      at: pct(patience, PATIENCE_RANGE.min, PATIENCE_RANGE.max),
      fill: [0, pct(patience, PATIENCE_RANGE.min, PATIENCE_RANGE.max)],
    },
    {
      id: "noise",
      label: voice(k.noise.label),
      value: null,
      minLabel: voice(k.noise.min),
      midLabel: null,
      maxLabel: voice(k.noise.max),
      at: pct(d.noiseReduction, NOISE_RANGE.min, NOISE_RANGE.max),
      fill: [0, pct(d.noiseReduction, NOISE_RANGE.min, NOISE_RANGE.max)],
    },
  ];
  const defaults: Record<(typeof CONFIG_MOCK_SWITCHES)[number]["id"], boolean> = {
    bargeIn: d.bargeIn,
    languageLock: d.languageLock,
    aiDisclosure: AI_DISCLOSURE_DEFAULT,
  };
  const switches = CONFIG_MOCK_SWITCHES.map((s) => ({
    id: s.id,
    label: (s.ns === "VoiceBrick" ? voice : persona)(s.key),
    on: defaults[s.id],
  }));
  return { sliders, switches };
}
