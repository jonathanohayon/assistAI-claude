"use client";

/**
 * Tuile "Persona" : the Persona brick (name, language, first sentence, AI
 * disclosure) and the available-tools hint. The agent's instructions and the
 * admin-only inheritance of shared directives live in the Knowledge brick.
 *
 * Utilisé par : config-form.tsx (workspace de la tuile `persona`).
 */

import { ToolsAvailableHint } from "./tools-available-hint";
import type { FormState, FormUpdater } from "./types";
import { PersonaBrick } from "@/components/bricks/persona/PersonaBrick";
import type { Persona } from "@/lib/persona/contract";

export function PersonaPanel({
  form,
  update,
  persona,
  onPersonaChange,
  isAdmin,
  asUserId,
}: {
  form: FormState;
  update: FormUpdater;
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

      {/* Tools disponibles — built-in + knowledge */}
      <ToolsAvailableHint form={form} update={update} />
    </div>
  );
}
