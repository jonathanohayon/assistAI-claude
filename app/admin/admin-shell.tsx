"use client";

import { useCallback, useEffect, useState } from "react";

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
import type { PlanPricingMap } from "@/lib/plan-pricing";

import { AdminTable } from "./admin-table";
import { BlockOrderForm } from "./block-order-form";
import FinanceDashboard from "./finance/FinanceDashboard";
import { GlobalInstructionsForm } from "./global-instructions-form";
import { PlanFeaturesForm } from "./plan-features-form";
import { PlanPricingForm } from "./plan-pricing-form";
import { SystemDirectivesForm } from "./system-directives-form";

type TileId =
  | "global-rules"
  | "persona-template"
  | "summary-prompt"
  | "directives"
  | "block-order"
  | "features"
  | "pricing"
  | "users"
  | "finance";

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
  planPricing: PlanPricingMap;
  rows: AdminTableRow[];
  currentUserId: string;
}

/**
 * Drag & drop helper — réutilisable pour réordonner une liste d'IDs via
 * native HTML5 DnD. Renvoie les handlers à coller sur chaque item + un
 * setter pour mettre à jour la liste après un drop réussi.
 *
 * Pourquoi pas une lib (dnd-kit, react-dnd) ? On a déjà le même pattern
 * dans block-order-form.tsx et la complexité n'est pas justifiée pour
 * un simple list reorder.
 */
function useDnDReorder<T extends string>(
  order: ReadonlyArray<T>,
  setOrder: (next: T[]) => void,
) {
  const [dragSrc, setDragSrc] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const onDragStart = (i: number) => (e: React.DragEvent) => {
    setDragSrc(i);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(i));
  };
  const onDragEnter = (i: number) => () => {
    if (dragSrc == null || dragSrc === i) {
      setDragOver(null);
      return;
    }
    setDragOver(i);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const onDrop = (target: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragSrc == null || dragSrc === target) {
      setDragSrc(null);
      setDragOver(null);
      return;
    }
    const next = [...order];
    const [moved] = next.splice(dragSrc, 1);
    if (moved) next.splice(target, 0, moved);
    setOrder(next);
    setDragSrc(null);
    setDragOver(null);
  };
  const onDragEnd = () => {
    setDragSrc(null);
    setDragOver(null);
  };

  return { dragSrc, dragOver, onDragStart, onDragEnter, onDragOver, onDrop, onDragEnd };
}

/** Persiste un ordre custom dans localStorage. Default → ordre canonique. */
const ADMIN_TILE_ORDER_KEY = "tamara.admin.tileOrder.v1";

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
      id: "pricing",
      label: "Tarifs",
      tagline: "Grille tarifaire EUR + ILS par plan, facturée via HYP.",
      summary: "EUR/ILS · mensuel + annuel",
      accent: "from-[#f59e0b] to-[#d97706]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
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
    {
      id: "finance",
      label: "Finance",
      tagline: "Coûts OpenAI, Twilio, WhatsApp · revenu, marge · par tenant.",
      summary: "Coûts estimés · global & par tenant",
      accent: "from-[#059669] to-[#10b981]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M3 3v18h18" />
          <path d="M7 15l4-4 3 3 5-6" />
        </svg>
      ),
    },
  ] as const;

  // Ordre custom des tiles (drag & drop persistant en localStorage).
  // Défaut = ordre déclaré ci-dessus. Si le user a déjà rearrangé, on
  // applique son ordre + on append en queue les tiles ajoutées depuis.
  const defaultOrder = tiles.map((t) => t.id);
  const [tileOrder, setTileOrder] = useState<TileId[]>(defaultOrder);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ADMIN_TILE_ORDER_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as unknown;
      if (!Array.isArray(saved)) return;
      const known = new Set(defaultOrder);
      const out: TileId[] = [];
      const seen = new Set<TileId>();
      for (const x of saved) {
        if (typeof x === "string" && known.has(x as TileId) && !seen.has(x as TileId)) {
          out.push(x as TileId);
          seen.add(x as TileId);
        }
      }
      // Append toute tile ajoutée depuis le dernier save (forward-compat)
      for (const id of defaultOrder) if (!seen.has(id)) out.push(id);
      setTileOrder(out);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const persistOrder = useCallback((next: TileId[]) => {
    setTileOrder(next);
    try {
      localStorage.setItem(ADMIN_TILE_ORDER_KEY, JSON.stringify(next));
    } catch {
      // ignore (mode privé, storage plein, etc.)
    }
  }, []);

  const dnd = useDnDReorder(tileOrder, persistOrder);

  // Map id → tile pour rendre dans l'ordre custom du user.
  const tileById = Object.fromEntries(tiles.map((t) => [t.id, t])) as Record<
    TileId,
    TileDef
  >;
  const orderedTiles = tileOrder.map((id) => tileById[id]).filter(Boolean);

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

      {/* Tile grid — drag-and-drop pour réordonner. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {orderedTiles.map((tile, i) => (
          <Tile
            key={tile.id}
            tile={tile}
            active={active === tile.id}
            onClick={() =>
              setActive((curr) => (curr === tile.id ? null : tile.id))
            }
            delay={i * 60}
            draggable
            isDragging={dnd.dragSrc === i}
            isDropTarget={dnd.dragOver === i}
            onDragStart={dnd.onDragStart(i)}
            onDragEnter={dnd.onDragEnter(i)}
            onDragOver={dnd.onDragOver}
            onDrop={dnd.onDrop(i)}
            onDragEnd={dnd.onDragEnd}
          />
        ))}
        {/* 2 placeholders : "rajoute des boxes ensuite" */}
        <AddTile delay={orderedTiles.length * 60} />
        <AddTile delay={(orderedTiles.length + 1) * 60} />
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
            {active === "pricing" && (
              <PlanPricingForm initialPricing={props.planPricing} />
            )}
            {active === "users" && (
              <AdminTable rows={props.rows} currentUserId={props.currentUserId} />
            )}
            {active === "finance" && <FinanceDashboard />}
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
  draggable = false,
  isDragging = false,
  isDropTarget = false,
  onDragStart,
  onDragEnter,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  tile: TileDef;
  active: boolean;
  onClick: () => void;
  delay?: number;
  draggable?: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnter?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`admin-tile-anim group relative flex aspect-square flex-col items-start justify-between overflow-hidden rounded-2xl border-2 p-4 text-left transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2 ${
        isDragging
          ? "border-[#ec4899] bg-white opacity-50 ring-2 ring-[#ec4899]/40"
          : isDropTarget
            ? "border-[#ec4899] shadow-[0_0_0_3px_rgba(236,72,153,0.2)]"
            : active
              ? "border-[#0e7490] bg-white shadow-[0_8px_32px_-8px_rgba(14,116,144,0.4)] -translate-y-0.5"
              : "border-white/50 bg-white/75 backdrop-blur-xl hover:-translate-y-1 hover:border-[#0e7490]/40 hover:bg-white hover:shadow-lg"
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Drop indicator gradient au-dessus de la tile ciblée */}
      {isDropTarget && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-1 left-3 right-3 h-[2px] rounded-full bg-gradient-to-r from-[#be185d] via-[#ec4899] to-[#22d3ee]"
        />
      )}
      {/* Drag handle (visible au hover, top-right) — 6 dots SVG. Indique
       *  que la tile est réorganisable, sans encombrer l'UI au repos. */}
      {draggable && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-2.5 top-2.5 text-[#94a3b8] opacity-0 transition-opacity group-hover:opacity-70"
          title="Glisse pour réordonner"
        >
          <svg viewBox="0 0 10 16" fill="currentColor" className="h-3.5 w-2.5">
            <circle cx="2" cy="3" r="1.3" />
            <circle cx="8" cy="3" r="1.3" />
            <circle cx="2" cy="8" r="1.3" />
            <circle cx="8" cy="8" r="1.3" />
            <circle cx="2" cy="13" r="1.3" />
            <circle cx="8" cy="13" r="1.3" />
          </svg>
        </span>
      )}
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
