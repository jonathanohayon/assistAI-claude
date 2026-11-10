"use client";

/**
 * Tuile "Persona" : the Persona brick (name, language, first sentence, AI
 * disclosure). The agent's instructions and the admin-only inheritance of
 * shared directives live in the Knowledge brick; what the agent can do lives
 * in the Tools brick (no technical tool names for tenants).
 *
 * Utilisé par : config-form.tsx (workspace de la tuile `persona`).
 */

import type { FormState } from "./types";
import { PersonaBrick } from "@/components/bricks/persona/PersonaBrick";
import type { Persona } from "@/lib/persona/contract";

export function PersonaPanel({
  form,
  persona,
  onPersonaChange,
  isAdmin,
  asUserId,
}: {
  form: FormState;
  persona: Persona;
  onPersonaChange: (next: Persona) => void;
  isAdmin: boolean;
  asUserId?: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Who answers: name, language, first sentence + preview, AI disclosure. */}
      <PersonaBrick
        value={persona}
        onChange={onPersonaChange}
        kind="inbound"
        businessName={form.business?.identity?.name ?? ""}
        isAdmin={isAdmin}
        asUserId={asUserId ?? null}
      />
    </div>
  );
}
