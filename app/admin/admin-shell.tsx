"use client";

import { useState } from "react";

import type {
  ConfigBlocksDirectiveByPlan,
  GlobalInstructionsByPlan,
  GreetingFallbackTemplateByPlan,
  HangupDirectiveByPlan,
  OnboardingTemplateByPlan,
  PerCallContextTemplateByPlan,
  PromptBlockOrderByPlan,
  SpokenPhoneDirectiveByPlan,
  SpokenTimeDirectiveByPlan,
  SummaryPromptByPlan,
} from "@/lib/settings";
import type { PlanFeatureMatrix } from "@/lib/plan-features";

import { AdminTable } from "./admin-table";
import { BlockOrderForm } from "./block-order-form";
import { GlobalInstructionsForm } from "./global-instructions-form";
import { PlanFeaturesForm } from "./plan-features-form";
import { SystemDirectivesForm } from "./system-directives-form";

type TileId =
  | "global-rules"
  | "persona-template"
  | "summary-prompt"
  | "directives"
  | "block-order"
  | "features"
  | "users";

interface TileDef {
  id: TileId;
  label: string;
  tagline: string;
  summary: string;
  /** Tailwind gradient classes pour l'icône + halo (from-... to-...). */
  accent: string;
  icon: React.ReactNode;
}

// Shape minimale alignée sur le composant AdminTable (interne).
// Évite de dupliquer le typing exact qui peut diverger — on accepte un
// large compatible. Le composant AdminTable validera ce qu'il utilise.
type AdminTableRow = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  createdAt: Date | string;
  numbers: Array<{ id: string; phoneNumber: string; label: string }>;
};

export interface AdminShellProps {
  globalInstructionsByPlan: GlobalInstructionsByPlan;
  onboardingTemplateByPlan: OnboardingTemplateByPlan;
  summaryPromptByPlan: SummaryPromptByPlan;
  spokenTimeByPlan: SpokenTimeDirectiveByPlan;
  spokenPhoneByPlan: SpokenPhoneDirectiveByPlan;
  hangupByPlan: HangupDirectiveByPlan;
  perCallContextByPlan: PerCallContextTemplateByPlan;
  configBlocksByPlan: ConfigBlocksDirectiveByPlan;
  promptBlockOrderByPlan: PromptBlockOrderByPlan;
  greetingFallbackByPlan: GreetingFallbackTemplateByPlan;
  planFeatures: PlanFeatureMatrix;
  rows: AdminTableRow[];
  currentUserId: string;
}

export function AdminShell(props: AdminShellProps) {
  const [active, setActive] = useState<TileId | null>(null);

  const tiles: ReadonlyArray<TileDef> = [
    {
      id: "global-rules",
      label: "Règles communes",
      tagline: "Préfixe système collé devant chaque persona tenant.",
      summary: "Per-plan, live · prochain appel",
      accent: "from-[#be185d] to-[#ec4899]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4Z" />
        </svg>
      ),
    },
    {
      id: "persona-template",
      label: "Persona template",
      tagline: "Squelette de persona copié à l'inscription de chaque tenant.",
      summary: "Per-plan, seed nouveaux comptes",
      accent: "from-[#ec4899] to-[#f472b6]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <circle cx="12" cy="8" r="4" />
          <path d="M5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
        </svg>
      ),
    },
    {
      id: "summary-prompt",
      label: "Résumé WhatsApp",
      tagline: "System prompt OpenAI qui génère le récap post-appel.",
      summary: "Per-plan, applied at runtime",
      accent: "from-[#f472b6] to-[#fb7185]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      ),
    },
    {
      id: "directives",
      label: "Directives système",
      tagline: "Heures, numéros, fin d'appel, contexte, blocs, fallback.",
      summary: "6 directives per-plan",
      accent: "from-[#22d3ee] to-[#0e7490]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="17" y1="16" x2="23" y2="16" />
        </svg>
      ),
    },
    {
      id: "block-order",
      label: "Ordre des blocs",
      tagline: "Drag & drop l'ordre des blocs injectés dans le prompt.",
      summary: "Per-plan",
      accent: "from-[#fb7185] to-[#f59e0b]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      ),
    },
    {
      id: "features",
      label: "Plan × Features",
      tagline: "Matrice qui pilote quels tools chaque plan peut utiliser.",
      summary: "Calendar, CRM, WhatsApp, ...",
      accent: "from-[#ec4899] to-[#fb7185]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="m14 17 3 3 4-5" />
        </svg>
      ),
    },
    {
      id: "users",
      label: "Utilisateurs",
      tagline: "Liste des tenants, impersonate, gestion essai, suppression.",
      summary: `${props.rows.length} tenant${props.rows.length > 1 ? "s" : ""}`,
      accent: "from-[#0e7490] to-[#134e4a]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
  ] as const;

  return (
    <>
      <style>{`
        @keyframes admin-tile-fade-up { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes admin-tile-bounce-in { 0% { opacity: 0; transform: scale(0.94); } 60% { transform: scale(1.02); } 100% { opacity: 1; transform: scale(1); } }
        .admin-tile-anim { animation: admin-tile-bounce-in 0.5s cubic-bezier(0.34,1.56,0.64,1) backwards; }
        .admin-panel-anim { animation: admin-tile-fade-up 0.45s cubic-bezier(0.16,1,0.3,1) backwards; }
      `}</style>

      <div className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#be185d]">
          Configuration
        </p>
        <h2 className="mt-1 font-display text-2xl tracking-tight text-[#18181b]">
          Tableau de bord admin
        </h2>
        <p className="mt-1 text-sm text-[#475569]">
          {active
            ? "Section active — clique sur la croix pour fermer."
            : "Clique sur une box pour éditer la section correspondante."}
        </p>
      </div>

      {/* Tile grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {tiles.map((tile, i) => (
          <Tile
            key={tile.id}
            tile={tile}
            active={active === tile.id}
            onClick={() =>
              setActive((curr) => (curr === tile.id ? null : tile.id))
            }
            delay={i * 60}
          />
        ))}
        {/* 2 placeholders : "rajoute des boxes ensuite" */}
        <AddTile delay={tiles.length * 60} />
        <AddTile delay={(tiles.length + 1) * 60} />
      </div>

      {/* Expanded panel for the active tile */}
      {active && (
        <div
          key={active}
          className="admin-panel-anim mt-6 overflow-hidden rounded-[2rem] border border-white/40 bg-white/85 shadow-[0_4px_24px_-8px_rgba(190,24,93,0.15)] backdrop-blur-xl"
        >
          <header className="flex items-center justify-between gap-3 border-b border-[#e2e8f0] bg-gradient-to-br from-white/60 to-white/30 px-6 py-4 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${tiles.find((t) => t.id === active)?.accent} text-white shadow-md`}
              >
                {tiles.find((t) => t.id === active)?.icon}
              </span>
              <div className="min-w-0">
                <h3 className="text-lg font-extrabold tracking-tight text-[#18181b] sm:text-xl">
                  {tiles.find((t) => t.id === active)?.label}
                </h3>
                <p className="truncate text-xs text-[#475569]">
                  {tiles.find((t) => t.id === active)?.tagline}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActive(null)}
              aria-label="Fermer la section"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/80 text-[#475569] transition-all hover:bg-[#fee2e2] hover:text-[#dc2626] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-4 w-4">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>

          <div className="px-6 py-6 sm:px-8 sm:py-7">
            {(active === "global-rules" ||
              active === "persona-template" ||
              active === "summary-prompt") && (
              <GlobalInstructionsForm
                initialGlobalByPlan={props.globalInstructionsByPlan}
                initialTemplateByPlan={props.onboardingTemplateByPlan}
                initialSummaryPromptByPlan={props.summaryPromptByPlan}
                section={
                  active === "global-rules"
                    ? "global"
                    : active === "persona-template"
                      ? "template"
                      : "summary"
                }
              />
            )}
            {active === "directives" && (
              <SystemDirectivesForm
                initialByPlan={{
                  spokenTime: props.spokenTimeByPlan,
                  spokenPhone: props.spokenPhoneByPlan,
                  hangup: props.hangupByPlan,
                  perCallCtx: props.perCallContextByPlan,
                  configBlocks: props.configBlocksByPlan,
                  greetingFallback: props.greetingFallbackByPlan,
                }}
              />
            )}
            {active === "block-order" && (
              <BlockOrderForm initialOrderByPlan={props.promptBlockOrderByPlan} />
            )}
            {active === "features" && (
              <PlanFeaturesForm initialMatrix={props.planFeatures} />
            )}
            {active === "users" && (
              <AdminTable rows={props.rows} currentUserId={props.currentUserId} />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Tile({
  tile,
  active,
  onClick,
  delay = 0,
}: {
  tile: TileDef;
  active: boolean;
  onClick: () => void;
  delay?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`admin-tile-anim group relative flex aspect-square flex-col items-start justify-between overflow-hidden rounded-2xl border-2 p-4 text-left transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2 ${
        active
          ? "border-[#0e7490] bg-white shadow-[0_8px_32px_-8px_rgba(14,116,144,0.4)] -translate-y-0.5"
          : "border-white/50 bg-white/75 backdrop-blur-xl hover:-translate-y-1 hover:border-[#0e7490]/40 hover:bg-white hover:shadow-lg"
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {active && (
        <span
          aria-hidden
          className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${tile.accent} opacity-20 blur-2xl`}
        />
      )}
      <span
        className={`relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${tile.accent} text-white shadow-md transition-transform group-hover:scale-110 group-hover:rotate-3`}
      >
        {tile.icon}
      </span>
      <div className="relative w-full min-w-0">
        <p className="text-base font-extrabold tracking-tight text-[#18181b]">
          {tile.label}
        </p>
        <p className="mt-0.5 line-clamp-2 text-[11px] font-medium italic leading-snug text-[#0e7490]">
          {tile.tagline}
        </p>
        <p className="mt-1 truncate text-[10px] text-[#475569]">{tile.summary}</p>
      </div>
      {active && (
        <span
          aria-hidden
          className="absolute right-3 top-3 h-2 w-2 rounded-full bg-[#0e7490] motion-safe:animate-pulse"
        />
      )}
    </button>
  );
}

function AddTile({ delay = 0 }: { delay?: number }) {
  return (
    <div
      className="admin-tile-anim flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#cbd5e1] bg-white/30 p-4 text-[#94a3b8] backdrop-blur"
      style={{ animationDelay: `${delay}ms` }}
      title="Place pour une future section admin"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-dashed border-[#cbd5e1]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <p className="text-center text-[11px] font-medium">Bientôt</p>
    </div>
  );
}
