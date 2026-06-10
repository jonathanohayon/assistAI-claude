/**
 * Constantes & mappings du système de personnalité de l'agent vocal :
 * - PERSONALITY_SLIDER_META : les 9 sliders (icônes SVG, animation, enabled)
 * - PERSONALITY_DEFAULT : valeurs par défaut 1-10
 * - conversions échelle UI 1-10 ↔ valeurs API OpenAI (speed, temperature)
 *
 * Utilisé par : config-form.tsx (get/setPersonalityValue, resetPersonality)
 * et voice-panel.tsx (rendu des sliders).
 */

import type { Personality } from "./types";

// 9 dimensions de personnalité — 3 branchées E2E (vitesse → speed,
// creativite → temperature, reactivite → VAD silence_duration_ms côté
// /api/session), 6 autres en preview UI seulement (DB persisté mais agent
// vocal ne les consomme pas encore).
//
// Module-level : SEULEMENT les icons/anim/enabled/badge. Les labels sont
// construits dynamiquement via t() dans le composant (voir `sliderDefs`).
export const PERSONALITY_SLIDER_META = [
  { key: "vitesse", anim: "anim-slide-x", enabled: true, badge: "OpenAI", icon: (
    <>
      <polygon points="13 19 22 12 13 5 13 19" />
      <polygon points="2 19 11 12 2 5 2 19" />
    </>
  ) },
  { key: "creativite", anim: "anim-sparkle", enabled: true, badge: "OpenAI", icon: (
    <path d="M12 3l1.9 5.8L20 10l-5 4.8 1.5 6.2L12 17.8 7.5 21 9 14.8 4 10l6.1-1.2z" />
  ) },
  { key: "reactivite", anim: "anim-pulse-quick", enabled: true, badge: "VAD", icon: (
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  ) },
  { key: "joie", anim: "anim-bounce-soft", enabled: false, badge: undefined as string | undefined, icon: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </>
  ) },
  { key: "empathie", anim: "anim-pulse-soft", enabled: false, badge: undefined as string | undefined, icon: (
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  ) },
  { key: "dynamisme", anim: "anim-flash", enabled: false, badge: undefined as string | undefined, icon: (
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  ) },
  { key: "professionnel", anim: "anim-tilt", enabled: false, badge: undefined as string | undefined, icon: (
    <>
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </>
  ) },
  { key: "humour", anim: "anim-wiggle", enabled: false, badge: undefined as string | undefined, icon: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M7 13a5 5 0 0 0 10 0" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </>
  ) },
  { key: "accent", anim: "anim-spin-slow", enabled: false, badge: undefined as string | undefined, icon: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>
  ) },
] as const;

export const PERSONALITY_DEFAULT: Personality = {
  vitesse: 5,
  creativite: 5,
  reactivite: 5,
  joie: 6,
  empathie: 8,
  dynamisme: 7,
  professionnel: 7,
  humour: 4,
  accent: 3,
};

// Mappings entre l'échelle UI 1-10 et les valeurs API OpenAI réelles.
// Speed : 0.5x → 1.5x sur l'API, 1 → 10 côté UI (5 = 1.0x baseline).
// Temperature : 0 → 1.5 sur l'API, 1 → 10 côté UI.
// Réactivité : la valeur 1-10 est passée telle quelle à /api/session
// qui calcule silence_duration_ms (1200ms → 200ms).
export const speedFromUI = (ui: number) => 0.5 + ((ui - 1) / 9) * 1.0; // 0.5..1.5
export const uiFromSpeed = (api: number) =>
  Math.round(((api - 0.5) / 1.0) * 9 + 1);
export const tempFromUI = (ui: number) => ((ui - 1) / 9) * 1.5; // 0..1.5
export const uiFromTemp = (api: number) => Math.round((api / 1.5) * 9 + 1);

export const clamp10 = (n: number) => Math.min(10, Math.max(1, Math.round(n)));
