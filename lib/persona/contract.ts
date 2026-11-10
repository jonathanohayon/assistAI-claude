// The Persona contract (v1): WHO the agent is on the phone — its name, its
// languages and its first sentence. ONE structure for every agent type
// (receptionist, outbound agents, third-party agent). Pure, tenant-safe (no
// supplier word). The tone is NOT here: it is the Voice brick's `style`.
//
// Every default equals TODAY's behaviour (proven in
// scripts/tests/persona-contract.test.ts): the first sentence and the
// language sent to the engine are unchanged, on both sides.

import { z } from "zod";

import { AI_DISCLOSURE_MAX_LENGTH, mentionsAi } from "@/lib/ai-disclosure";

export const PERSONA_CONTRACT_VERSION = 1 as const;

export const PERSONA_LANGUAGES = ["fr", "he", "en"] as const;
export type PersonaLanguage = (typeof PERSONA_LANGUAGES)[number];

/** "auto" = the agent opens by itself (no fixed sentence); "custom" = the tenant's sentence. */
export const GREETING_MODES = ["auto", "custom"] as const;
export type GreetingMode = (typeof GREETING_MODES)[number];

const L = { name: 80, greeting: 1000 } as const;

export const personaSchema = z
  .object({
    version: z.literal(PERSONA_CONTRACT_VERSION),
    name: z.string().max(L.name),
    primaryLanguage: z.enum(PERSONA_LANGUAGES),
    greeting: z
      .object({
        mode: z.enum(GREETING_MODES),
        /** Kept even in "auto" mode, so switching back restores it. */
        text: z.string().max(L.greeting),
      })
      .strict(),
    /** Other languages the agent may switch to (P4). Empty = today. */
    languages: z.array(z.enum(PERSONA_LANGUAGES)).max(3),
    aiDisclosure: z
      .object({
        enabled: z.boolean(),
        /** '' = the localized default sentence; a custom one must mention AI. */
        text: z
          .string()
          .max(AI_DISCLOSURE_MAX_LENGTH)
          .refine((t) => !t.trim() || mentionsAi(t), { message: "ai_disclosure_must_mention_ai" }),
      })
      .strict(),
  })
  .strict()
  .refine((p) => !p.languages.includes(p.primaryLanguage), {
    message: "languages must not repeat the primary language",
    path: ["languages"],
  });

export type Persona = z.infer<typeof personaSchema>;

/** A new receptionist: today's column defaults. */
export const DEFAULT_PERSONA: Persona = {
  version: PERSONA_CONTRACT_VERSION,
  name: "",
  primaryLanguage: "fr",
  greeting: { mode: "auto", text: "" },
  languages: [],
  aiDisclosure: { enabled: true, text: "" },
};

// ── Levels ──────────────────────────────────────────────────────────────
// 1 = Essential · 2 = "More settings" · 3 = developer mode (greeting variables).

export type PersonaLevel = 1 | 2 | 3;
export const PERSONA_FIELD_LEVEL = {
  name: 1,
  primaryLanguage: 1,
  "greeting.mode": 1,
  "greeting.text": 1,
  languages: 2,
  "aiDisclosure.enabled": 2,
  "aiDisclosure.text": 2,
} as const satisfies Record<string, PersonaLevel>;

/**
 * Variables usable in the first sentence (level 3), per side. The contract
 * follows the ENGINE (tested in persona-greeting-variables.test.ts):
 *   - outbound: lib/campaigns/prompt.ts substituteVars replaces {{name}} and
 *     {{phone}} (plus {{<column>}} of the contact's imported vars, which
 *     depend on each campaign's file and are not listed here);
 *   - inbound: nothing substitutes the tenant's sentence (the worker only
 *     fills {agent_name} in the ADMIN fallback template) → none offered.
 * Labels for humans live in the screen's i18n, keyed by the variable.
 */
export const GREETING_VARIABLES = {
  inbound: [] as const,
  outbound: ["{{name}}", "{{phone}}"] as const,
} as const;

export function greetingModeOf(text: string): GreetingMode {
  return text.trim() ? "custom" : "auto";
}

// ── Validation ──────────────────────────────────────────────────────────

export type PersonaParse = { ok: true; value: Persona } | { ok: false; error: string };

export function parsePersona(raw: unknown): PersonaParse {
  const r = personaSchema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  const issue = r.error.issues[0];
  return { ok: false, error: `persona.${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}` };
}

/** Partial write onto a stored persona; `greeting` and `aiDisclosure` merge key by key. */
export function mergePersona(stored: Persona, patch: unknown): PersonaParse {
  if (!patch || typeof patch !== "object") return { ok: false, error: "persona: invalid" };
  const p = patch as Record<string, unknown>;
  const sub = (k: "greeting" | "aiDisclosure") =>
    p[k] && typeof p[k] === "object" ? (p[k] as Record<string, unknown>) : {};
  return parsePersona({
    ...stored,
    ...p,
    version: PERSONA_CONTRACT_VERSION,
    greeting: { ...stored.greeting, ...sub("greeting") },
    aiDisclosure: { ...stored.aiDisclosure, ...sub("aiDisclosure") },
  });
}
