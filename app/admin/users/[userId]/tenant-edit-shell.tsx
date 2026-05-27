"use client";

import { useCallback, useEffect, useState } from "react";

import type { PromptBlock } from "@/lib/agent-prompt-preview";

import { PromptPreview } from "./prompt-preview";
import {
  AdminTenantConfigForm,
  type TenantConfigSection,
} from "./tenant-config-form";

type TileId = TenantConfigSection | "preview";

interface TileDef {
  id: TileId;
  label: string;
  tagline: string;
  summary: string;
  /** Tailwind gradient classes pour l'icône + halo (from-... to-...). */
  accent: string;
  icon: React.ReactNode;
  /** Indique que la section est lecture seule (preview, audit). */
  readOnly?: boolean;
}

export interface TenantEditShellProps {
  userId: string;
  initial: {
    instructions: string;
    greetingInstructions: string;
    model: string;
    voice: string;
    temperature: number;
    speed: number;
    maxResponseTokens: number;
    ownerWhatsapp: string;
    primaryLanguage: string;
    inheritAdminGlobals: boolean;
  };
  initialVoices: readonly string[];
  adminInheritablePreview: string;
  planLabel: string;
  promptBlocks: PromptBlock[];
  fullPromptConcat: string;
}

export function TenantEditShell(props: TenantEditShellProps) {
  const [active, setActive] = useState<TileId | null>(null);

  const tiles: ReadonlyArray<TileDef> = [
    {
      id: "persona",
      label: "Persona & langue",
      tagline: "Instructions agent, langue d'accueil, phrase d'ouverture.",
      summary: "Identité du tenant",
      accent: "from-[#be185d] to-[#ec4899]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <circle cx="12" cy="8" r="4" />
          <path d="M5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
        </svg>
      ),
    },
    {
      id: "inherit",
      label: "Héritage admin",
      tagline: "Active/désactive les directives globales du plan.",
      summary: `Plan ${props.planLabel}`,
      accent: "from-[#ec4899] to-[#fb7185]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M9 11V6a3 3 0 0 1 6 0v5" />
          <rect x="5" y="11" width="14" height="10" rx="2" />
        </svg>
      ),
    },
    {
      id: "voice",
      label: "Voix & modèle",
      tagline: "Moteur vocal, température, vitesse, tokens max.",
      summary: "Paramètres techniques",
      accent: "from-[#22d3ee] to-[#0e7490]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      ),
    },
    {
      id: "whatsapp",
      label: "Notifications",
      tagline: "Numéro WhatsApp du proprio pour le récap d'appel.",
      summary: props.initial.ownerWhatsapp
        ? props.initial.ownerWhatsapp
        : "(non configuré)",
      accent: "from-[#fb7185] to-[#f59e0b]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      ),
    },
    {
      id: "preview",
      label: "Prompt assemblé",
      tagline: "Vue complète du system prompt envoyé à l'agent.",
      summary: "Lecture seule",
      accent: "from-[#0e7490] to-[#134e4a]",
      readOnly: true,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ),
    },
  ] as const;

  // ── Ordre custom des tiles (drag-and-drop persistant en localStorage) ──
  const TILE_ORDER_KEY = "tamara.tenant-edit.tileOrder.v1";
  const defaultOrder = tiles.map((t) => t.id);
  const [tileOrder, setTileOrder] = useState<TileId[]>(defaultOrder);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TILE_ORDER_KEY);
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
      localStorage.setItem(TILE_ORDER_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  // DnD handlers — pattern identique à AdminShell, inliné ici.
  const [dragSrc, setDragSrc] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dndDragStart = (i: number) => (e: React.DragEvent) => {
    setDragSrc(i);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(i));
  };
  const dndDragEnter = (i: number) => () => {
    if (dragSrc == null || dragSrc === i) {
      setDragOver(null);
      return;
    }
    setDragOver(i);
  };
  const dndDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const dndDrop = (target: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragSrc == null || dragSrc === target) {
      setDragSrc(null);
      setDragOver(null);
      return;
    }
    const next = [...tileOrder];
    const [moved] = next.splice(dragSrc, 1);
    if (moved) next.splice(target, 0, moved);
    persistOrder(next);
    setDragSrc(null);
    setDragOver(null);
  };
  const dndDragEnd = () => {
    setDragSrc(null);
    setDragOver(null);
  };

  // Map id → TileDef pour render dans l'ordre custom user.
  const tileById = Object.fromEntries(tiles.map((t) => [t.id, t])) as Record<
    TileId,
    TileDef
  >;
  const orderedTiles = tileOrder
    .map((id) => tileById[id])
    .filter((t): t is TileDef => Boolean(t));

  const activeTile = active ? tiles.find((t) => t.id === active) : null;

  // Section à passer au form pour conditionner l'affichage des Cards.
  // Si la tile active est "preview" ou null, on passe `undefined` (=
  // toutes), mais on cache le form via le wrapper plus bas pour éviter
  // de l'afficher en double avec la preview.
  const formSection: TenantConfigSection | undefined =
    active && active !== "preview" ? active : undefined;

  return (
    <>
      <style>{`
        @keyframes tenant-tile-fade-up { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes tenant-tile-bounce-in { 0% { opacity: 0; transform: scale(0.94); } 60% { transform: scale(1.02); } 100% { opacity: 1; transform: scale(1); } }
        .tenant-tile-anim { animation: tenant-tile-bounce-in 0.5s cubic-bezier(0.34,1.56,0.64,1) backwards; }
        .tenant-panel-anim { animation: tenant-tile-fade-up 0.45s cubic-bezier(0.16,1,0.3,1) backwards; }
      `}</style>

      <div className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#be185d]">
          Configuration tenant
        </p>
        <h2 className="mt-1 font-display text-2xl tracking-tight text-[#18181b]">
          Sections éditables
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
            isDragging={dragSrc === i}
            isDropTarget={dragOver === i}
            onDragStart={dndDragStart(i)}
            onDragEnter={dndDragEnter(i)}
            onDragOver={dndDragOver}
            onDrop={dndDrop(i)}
            onDragEnd={dndDragEnd}
          />
        ))}
        <AddTile delay={orderedTiles.length * 60} />
        <AddTile delay={(orderedTiles.length + 1) * 60} />
      </div>

      {/* Expanded panel for the active tile */}
      {active && activeTile && (
        <div
          key={active}
          className="tenant-panel-anim mt-6 overflow-hidden rounded-[2rem] border border-white/40 bg-white/85 shadow-[0_4px_24px_-8px_rgba(190,24,93,0.15)] backdrop-blur-xl"
        >
          <header className="flex items-center justify-between gap-3 border-b border-[#e2e8f0] bg-gradient-to-br from-white/60 to-white/30 px-6 py-4 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${activeTile.accent} text-white shadow-md`}
              >
                {activeTile.icon}
              </span>
              <div className="min-w-0">
                <h3 className="text-lg font-extrabold tracking-tight text-[#18181b] sm:text-xl">
                  {activeTile.label}
                </h3>
                <p className="truncate text-xs text-[#475569]">
                  {activeTile.tagline}
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
            {active === "preview" ? (
              <PromptPreview
                blocks={props.promptBlocks}
                fullPrompt={props.fullPromptConcat}
                userId={props.userId}
              />
            ) : (
              <AdminTenantConfigForm
                userId={props.userId}
                initial={props.initial}
                initialVoices={props.initialVoices}
                adminInheritablePreview={props.adminInheritablePreview}
                planLabel={props.planLabel}
                section={formSection}
              />
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
      className={`tenant-tile-anim group relative flex aspect-square flex-col items-start justify-between overflow-hidden rounded-2xl border-2 p-4 text-left transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2 ${
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
      {isDropTarget && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-1 left-3 right-3 h-[2px] rounded-full bg-gradient-to-r from-[#be185d] via-[#ec4899] to-[#22d3ee]"
        />
      )}
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
        <p className="mt-1 truncate text-[10px] text-[#475569]">
          {tile.summary}
        </p>
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
      className="tenant-tile-anim flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#cbd5e1] bg-white/30 p-4 text-[#94a3b8] backdrop-blur"
      style={{ animationDelay: `${delay}ms` }}
      title="Place pour une future section tenant"
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
