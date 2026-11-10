// `persona` → the legacy body fields the routes accept today (until P3
// stores `persona` itself). Pure, tenant-safe. The screen edits a Persona and
// saves through these, so behaviour stays exactly today's.
//
// Known limits until P3:
//   - "auto" mode can't keep the custom text (the column holds one value):
//     greetingInstructions/greeting = "" in auto, the text is lost on reload;
//   - `languages` has no column (P4): not written;
//   - outbound has no AI-disclosure column (P5): not written.

import type { Persona } from "@/lib/persona/contract";

export interface InboundPersonaBody {
  agentName: string;
  primaryLanguage: string;
  greetingInstructions: string;
  aiDisclosureEnabled: boolean;
  aiDisclosureText: string;
}

export function personaToInboundColumns(p: Persona): InboundPersonaBody {
  return {
    agentName: p.name,
    primaryLanguage: p.primaryLanguage,
    greetingInstructions: p.greeting.mode === "custom" ? p.greeting.text : "",
    aiDisclosureEnabled: p.aiDisclosure.enabled,
    aiDisclosureText: p.aiDisclosure.text,
  };
}

export interface OutboundPersonaBody {
  agentName: string;
  language: string;
  greeting: string;
}

export function personaToOutboundColumns(p: Persona): OutboundPersonaBody {
  return {
    agentName: p.name,
    language: p.primaryLanguage,
    greeting: p.greeting.mode === "custom" ? p.greeting.text : "",
  };
}

/** Only the fields that differ from `before` (the screen sends changed fields only). */
export function changedFields<T extends object>(before: T, after: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(after) as Array<keyof T>) {
    if (before[k] !== after[k]) out[k] = after[k];
  }
  return out;
}
