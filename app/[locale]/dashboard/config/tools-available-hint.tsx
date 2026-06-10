"use client";

/**
 * Encart "Tools disponibles pour le prompt" : liste les tools built-in de
 * l'agent vocal (calendrier, cycle de vie) avec copie du nom au clic et
 * insertion d'un exemple d'usage dans les instructions persona.
 *
 * Utilisé par : persona-panel.tsx (au-dessus du textarea instructions).
 */

import { useState } from "react";

import type { FormState, FormUpdater } from "./types";

interface ToolSpec {
  name: string;
  description: string;
  example: string;
  category: "calendar" | "lifecycle" | "knowledge";
}

const BUILTIN_TOOLS: ToolSpec[] = [
  {
    name: "list_available_dates",
    description:
      "Retourne les prochaines dates ouvertes pour un centre donné. À appeler AVANT de proposer une date.",
    example: "« je voudrais un RDV à Jérusalem la semaine prochaine » → list_available_dates(center='jerusalem')",
    category: "calendar",
  },
  {
    name: "check_availability",
    description:
      "Vérifie les créneaux dispo pour une date + centre précis. L'API renvoie suggested_dates si la date ne matche pas.",
    example: "check_availability(date='2026-05-25', center='ashdod')",
    category: "calendar",
  },
  {
    name: "book_appointment",
    description:
      "Réserve un créneau définitivement. À appeler après confirmation explicite du client.",
    example: "book_appointment(date='2026-05-25', time='14:30', center='ashdod', client_name='...', service='...')",
    category: "calendar",
  },
  {
    name: "save_contact",
    description:
      "Enregistre les coordonnées d'une cliente sans réserver. Utile si elle ne sait pas encore quand venir.",
    example: "save_contact(name='Sarah', phone='0501234567', note='intéressée par massage')",
    category: "calendar",
  },
  {
    name: "find_appointment",
    description: "Cherche un RDV existant par nom client ou téléphone.",
    example: "find_appointment(query='Sarah Cohen')",
    category: "calendar",
  },
  {
    name: "cancel_appointment",
    description: "Annule un RDV existant (utilise find_appointment d'abord pour le SID).",
    example: "cancel_appointment(event_id='evt_...')",
    category: "calendar",
  },
  {
    name: "reschedule_appointment",
    description: "Change la date/heure d'un RDV existant.",
    example: "reschedule_appointment(event_id='evt_...', new_date='2026-05-26', new_time='15:00')",
    category: "calendar",
  },
  {
    name: "end_call",
    description:
      "Termine l'appel proprement (raccroche). À appeler quand le client dit au revoir ou que la conversation est finie.",
    example: "« merci au revoir » → end_call()",
    category: "lifecycle",
  },
];

const CATEGORY_META: Record<
  ToolSpec["category"],
  { label: string; color: string; bg: string; ring: string }
> = {
  calendar: {
    label: "📅 Calendrier (selon plan)",
    color: "#0e7490",
    bg: "#ecfeff",
    ring: "#22d3ee",
  },
  lifecycle: {
    label: "🔚 Cycle de vie appel",
    color: "#7c3aed",
    bg: "#f5f3ff",
    ring: "#a78bfa",
  },
  knowledge: {
    label: "📚 Tools knowledge (tes business)",
    color: "#b45309",
    bg: "#fffbeb",
    ring: "#f59e0b",
  },
};

export function ToolsAvailableHint({
  form,
  update,
}: {
  form: FormState;
  update: FormUpdater;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copiedTool, setCopiedTool] = useState<string | null>(null);

  // Les tools "knowledge" ne sont plus exposés ici : la nouvelle tile Business
  // structure l'identité/centres/services en JSON, et c'est le worker qui en
  // dérive les tools déterministes (5 tools fixes côté agent).
  const allTools = BUILTIN_TOOLS;
  const centresCount = form.business.centres.length;

  const copyName = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
      setCopiedTool(name);
      setTimeout(() => setCopiedTool(null), 1500);
    } catch {
      // pas critique
    }
  };

  const appendExample = (tool: ToolSpec) => {
    const snippet = `\n\nQuand le client pose une question pertinente, appelle \`${tool.name}\`.\n  Exemple : ${tool.example}`;
    update("instructions", (form.instructions ?? "") + snippet);
  };

  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-gradient-to-br from-[#f0f9ff]/60 to-white/30 p-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
            🛠️ Tools disponibles pour le prompt ({allTools.length})
          </p>
          <p className="mt-0.5 text-[11px] text-[#475569]">
            Cliquer le nom pour copier · &laquo; Insérer exemple &raquo; pour append au persona
            {centresCount > 0 && (
              <>
                {" "}·{" "}
                <span className="font-medium text-[#b45309]">
                  {centresCount} centre{centresCount > 1 ? "s" : ""} configuré{centresCount > 1 ? "s" : ""}
                </span>
              </>
            )}
          </p>
        </div>
        <span className="text-[#94a3b8]">{expanded ? "▼" : "▶"}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {(["knowledge", "calendar", "lifecycle"] as const).map((cat) => {
            const toolsInCat = allTools.filter((t) => t.category === cat);
            if (toolsInCat.length === 0) return null;
            const meta = CATEGORY_META[cat];
            return (
              <div key={cat}>
                <p
                  className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: meta.color }}
                >
                  {meta.label}
                </p>
                <div className="space-y-1.5">
                  {toolsInCat.map((tool) => (
                    <div
                      key={tool.name}
                      className="rounded-lg border bg-white/70 p-2.5"
                      style={{ borderColor: `${meta.ring}40` }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => copyName(tool.name)}
                          className="group inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[12px] font-semibold transition-colors"
                          style={{
                            backgroundColor: meta.bg,
                            color: meta.color,
                          }}
                          title="Click pour copier le nom du tool"
                        >
                          {tool.name}
                          {copiedTool === tool.name ? (
                            <span className="text-[10px] opacity-80">✓ copié</span>
                          ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3 w-3 opacity-50 group-hover:opacity-100">
                              <rect x="9" y="9" width="13" height="13" rx="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => appendExample(tool)}
                          className="text-[10px] font-medium text-[#0e7490] underline-offset-2 hover:underline"
                        >
                          Insérer exemple →
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-[#334155]">
                        {tool.description}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-[#64748b]">
                        {tool.example}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {centresCount === 0 && (
            <p className="rounded-lg bg-[#fffbeb]/60 px-3 py-2 text-[11px] text-[#92400e]">
              💡 Configure tes centres et soins dans la tile <strong>Business</strong> pour
              que l&apos;agent connaisse ton offre.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
