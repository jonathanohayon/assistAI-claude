// Persona brick — screen-side helpers over lib/persona/contract (P1). Pure,
// tenant-safe. The sentence callers hear comes from the ONE existing source
// per side, never re-implemented here:
//   inbound  → lib/ai-disclosure effectiveGreeting
//   outbound → lib/campaigns/prompt buildCampaignGreeting
//
// Until P3 stores `persona`, saves go through today's legacy fields, so the
// behaviour is exactly today's. The write mapping is tamaraVlad's
// lib/persona/columns (the one place P3 changes).

import { effectiveGreeting } from "@/lib/ai-disclosure";
import { buildCampaignGreeting } from "@/lib/campaigns/prompt";
import type { Persona } from "@/lib/persona/contract";

export { personaToInboundColumns, personaToOutboundColumns } from "@/lib/persona/columns";

export type PersonaKind = "inbound" | "outbound";

/** The sentence actually spoken: the tenant's in "custom" mode, none in "auto". */
const spokenGreeting = (p: Persona) => (p.greeting.mode === "custom" ? p.greeting.text : "");

/**
 * What changed since `base` (last loaded or saved), as the partial
 * personaConfig the API takes: top-level fields whole, `greeting` and
 * `aiDisclosure` key by key. null = nothing changed.
 */
export function personaPatch(base: Persona, next: Persona): Record<string, unknown> | null {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(next) as Array<keyof Persona>) {
    if (k === "version") continue;
    if (k === "greeting" || k === "aiDisclosure") {
      const sub: Record<string, unknown> = {};
      for (const [sk, sv] of Object.entries(next[k])) {
        if (!same((base[k] as Record<string, unknown>)[sk], sv)) sub[sk] = sv;
      }
      if (Object.keys(sub).length) patch[k] = sub;
    } else if (!same(base[k], next[k])) patch[k] = next[k];
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * What callers hear first, from the side's single source. null = no fixed
 * sentence: the agent opens by itself, from context.
 */
export function heardGreeting(
  p: Persona,
  kind: PersonaKind,
  ctx: { businessName?: string; exampleContact?: { contactName?: string; phoneNumber?: string } } = {},
): string | null {
  const text =
    kind === "inbound"
      ? effectiveGreeting(
          {
            greetingInstructions: spokenGreeting(p),
            agentName: p.name,
            primaryLanguage: p.primaryLanguage,
            aiDisclosureEnabled: p.aiDisclosure.enabled,
            aiDisclosureText: p.aiDisclosure.text,
          },
          ctx.businessName ?? "",
        )
      : buildCampaignGreeting({ persona: { greeting: spokenGreeting(p) } }, ctx.exampleContact ?? {});
  return text.trim() ? text : null;
}

/** Insert a variable at the end of the sentence, with a space if needed. */
export function insertVariable(text: string, variable: string): string {
  if (!text) return variable;
  return /\s$/.test(text) ? `${text}${variable}` : `${text} ${variable}`;
}

/** Legacy persona fields a screen must NOT send next to personaConfig (400 persona_config_conflict). */
export const LEGACY_INBOUND_PERSONA_FIELDS = [
  "agentName",
  "primaryLanguage",
  "greetingInstructions",
  "aiDisclosureEnabled",
  "aiDisclosureText",
] as const;
export const LEGACY_OUTBOUND_PERSONA_FIELDS = ["agentName", "language", "greeting"] as const;

/**
 * A save body without ANY legacy persona field (even unchanged: a legacy
 * write must never overwrite the stored sentence), plus the persona patch
 * when something changed.
 */
export function withPersonaConfig(
  body: Record<string, unknown>,
  legacy: readonly string[],
  patch: Record<string, unknown> | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  delete out.personaConfig;
  for (const k of legacy) delete out[k];
  if (patch) out.personaConfig = patch;
  return out;
}

/**
 * The heard sentence split into its sentences, punctuation kept. The
 * preview isolates each one (customer sentence and disclosure sentence may
 * be in different scripts), so mixed French/Hebrew never scrambles the
 * comma, full stop or quotes.
 */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]+["'»”)\s]*|[^.!?…]+$/gu) ?? [text];
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Braces a sentence must not contain: anything that isn't exactly one of
 * the variables this side substitutes (a broken "{{nam", an unknown
 * "{{city}}", a lone "{") would be read aloud on the call. [] = fine.
 */
export function badBraces(text: string, allowed: readonly string[]): string[] {
  let rest = text;
  for (const v of allowed) rest = rest.split(v).join(" ");
  const bad = rest.match(/\{+[^{}\s]*\}*|\}+/g) ?? [];
  return [...new Set(bad)];
}

/** Allowed variables present in the sentence (for the one-line helper). */
export function variablesIn(text: string, allowed: readonly string[]): string[] {
  return allowed.filter((v) => text.includes(v));
}

/** Why this persona can't be saved yet (null = fine): the screens call it before saving. */
export function personaSaveIssue(
  p: Persona,
  allowedVariables: readonly string[],
): { kind: "badBraces"; tokens: string[] } | null {
  if (p.greeting.mode !== "custom") return null;
  const tokens = badBraces(p.greeting.text, allowedVariables);
  return tokens.length ? { kind: "badBraces", tokens } : null;
}
