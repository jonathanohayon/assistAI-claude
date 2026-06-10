"use client";

/**
 * Petits composants UI réutilisés à travers le formulaire de configuration
 * (/dashboard) : AdminBadge, Tile/AddTile (grille de tuiles), EmptyState,
 * PersonalitySlider, RadioCard, Tag, Stat, Meta — plus le type TileDef.
 *
 * Utilisé par : config-form.tsx (tuiles, hero), voice-panel, persona-panel,
 * channels-panel, centres-section, services-section.
 * AdminBadge est aussi ré-exporté par config-form.tsx (export historique).
 */

import { useTranslations } from "next-intl";

// ─── Tile + AddTile ─────────────────────────────────────────────────────

export type TileDef = {
  id: string;
  label: string;
  tagline: string;
  summary: string;
  accent: string;
  icon: React.ReactNode;
  /** Si true, la tuile est visible UNIQUEMENT pour l'admin agissant
   *  sur un tenant — la tuile elle-même affiche un badge "ADMIN" pour
   *  rappeler que le tenant ne voit pas cette section sur son /dashboard. */
  adminOnly?: boolean;
  /** Si true, la tuile est visible mais verrouillée (feature premium non
   *  active) — affiche un cadenas + ruban "PRO", clic → modal d'upsell. */
  locked?: boolean;
};

/** Badge violet "ADMIN" — pour marquer les features/UI visibles
 *  uniquement par l'admin agissant sur un tenant. Petit shield + texte.
 *  Centralisé pour un look consistent partout (tuiles, sections, panels). */
export function AdminBadge({
  size = "sm",
  label = "ADMIN",
}: {
  size?: "xs" | "sm" | "md";
  label?: string;
}) {
  const padding =
    size === "xs"
      ? "px-1.5 py-0.5 text-[8px]"
      : size === "md"
        ? "px-2.5 py-1 text-[10px]"
        : "px-2 py-0.5 text-[9px]";
  const iconSize = size === "md" ? "h-3 w-3" : "h-2.5 w-2.5";
  return (
    <span
      title="Visible uniquement par l'admin — le tenant ne voit pas cette section sur son dashboard"
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-[#7c3aed]/10 ${padding} font-bold uppercase tracking-wider text-[#6d28d9] ring-1 ring-inset ring-[#7c3aed]/30`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={iconSize}
        aria-hidden
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
      {label}
    </span>
  );
}

/** Une tuile cliquable de la grille (avec drag & drop natif HTML5 pour
 *  réordonner — voir persistTileOrder dans config-form.tsx). */
export function Tile({
  tile,
  active,
  onClick,
  delay = 0,
  dragging = false,
  dropTarget = false,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
}: {
  tile: TileDef;
  active: boolean;
  onClick: () => void;
  delay?: number;
  dragging?: boolean;
  dropTarget?: boolean;
  onDragStart?: () => void;
  onDragEnter?: () => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", tile.id);
        onDragStart?.();
      }}
      onDragEnter={() => onDragEnter?.()}
      onDragOver={(e) => {
        // preventDefault OBLIGATOIRE pour autoriser le drop
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop?.();
      }}
      onDragEnd={() => onDragEnd?.()}
      className={`anim-bounce-in group relative flex aspect-square cursor-grab flex-col items-start justify-between overflow-hidden rounded-2xl border-2 p-4 text-left transition-all duration-300 active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2 ${
        dragging
          ? "border-[#0e7490] opacity-50 ring-2 ring-[#0e7490]/30"
          : dropTarget
            ? "border-[#0e7490] shadow-[0_0_0_3px_rgba(14,116,144,0.18)]"
            : active
              ? "border-[#0e7490] bg-white shadow-[0_8px_32px_-8px_rgba(14,116,144,0.4)] -translate-y-0.5"
              : "border-white/40 bg-white/70 backdrop-blur-xl hover:-translate-y-1 hover:border-[#0e7490]/40 hover:bg-white hover:shadow-lg"
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {active && (
        <span
          aria-hidden
          className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${tile.accent} opacity-15 blur-2xl`}
        />
      )}
      <div className="relative flex w-full items-start justify-between">
        <span
          className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${tile.accent} text-white shadow-md transition-transform group-hover:scale-110 group-hover:rotate-3`}
        >
          {tile.icon}
        </span>
        {tile.adminOnly && <AdminBadge size="xs" />}
        {tile.locked && (
          <span
            title="Disponible sur le plan Centre d'appels pro"
            className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-br ${tile.accent} px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-sm`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5" aria-hidden>
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            PRO
          </span>
        )}
      </div>
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

/** Tuile placeholder "bientôt disponible" en fin de grille. */
export function AddTile({ delay = 0 }: { delay?: number }) {
  const t = useTranslations("DashboardConfig");
  return (
    <div
      className="anim-bounce-in flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#cbd5e1] bg-white/30 p-4 text-[#94a3b8] backdrop-blur"
      style={{ animationDelay: `${delay}ms` }}
      title={t("wowAddTileTitle")}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-dashed border-[#cbd5e1]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <p className="text-center text-[11px] font-medium">{t("wowComingSoon")}</p>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────

/** État vide ambré avec icône + CTA optionnel (centres/soins/canaux). */
export function EmptyState({
  icon,
  title,
  body,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  cta?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[#fde68a] bg-[#fffbeb]/40 px-6 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f59e0b]/15 to-[#b45309]/15 text-[#b45309]" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
          {icon}
        </svg>
      </span>
      <p className="text-base font-extrabold tracking-tight text-[#18181b]">
        {title}
      </p>
      <p className="max-w-xs text-[12px] leading-relaxed text-[#92400e]">
        {body}
      </p>
      {cta && (
        <button
          type="button"
          onClick={cta.onClick}
          className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-gradient-to-br from-[#f59e0b] to-[#b45309] px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.03] hover:shadow-lg active:scale-95"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-3 w-3">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          {cta.label}
        </button>
      )}
    </div>
  );
}

// ─── PersonalitySlider ───────────────────────────────────────────────────

/** Slider 1-10 stylé (.fancy-slider) avec icône animée, badge et labels
 *  min/mid/max — utilisé par la tuile Voix & personnalité. */
export function PersonalitySlider({
  label,
  value,
  onChange,
  minLabel,
  maxLabel,
  midLabel,
  icon,
  animClass,
  enabled,
  badge,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  minLabel: string;
  maxLabel: string;
  midLabel: string;
  icon?: React.ReactNode;
  animClass?: string;
  enabled: boolean;
  badge?: string;
}) {
  const pct = ((value - 1) / 9) * 100;
  const trackGradient = enabled
    ? `linear-gradient(to right, #0891b2 0%, #22d3ee ${pct}%, #e0f7fa ${pct}%, #cffafe 100%)`
    : `linear-gradient(to right, #94a3b8 0%, #cbd5e1 ${pct}%, #f1f5f9 ${pct}%, #f1f5f9 100%)`;

  return (
    <div className={enabled ? "" : "opacity-60"}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon && (
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${enabled ? "from-[#ecfeff] to-[#cffafe] text-[#0e7490] ring-[#22d3ee]/30" : "from-[#f1f5f9] to-[#e2e8f0] text-[#94a3b8] ring-[#cbd5e1]"} ring-1 ring-inset ${enabled ? animClass ?? "" : ""}`}
              aria-hidden
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                {icon}
              </svg>
            </span>
          )}
          <p className="truncate text-sm font-semibold text-[#18181b]">
            {label}
          </p>
          {badge && (
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 ring-inset ${
                enabled
                  ? "bg-[#ecfeff] text-[#0e7490] ring-[#22d3ee]/40"
                  : "bg-[#f1f5f9] text-[#94a3b8] ring-[#cbd5e1]"
              }`}
            >
              {badge}
            </span>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full bg-gradient-to-br ${enabled ? "from-[#ecfeff] to-[#cffafe] text-[#0e7490] ring-[#22d3ee]/40" : "from-[#f1f5f9] to-[#e2e8f0] text-[#94a3b8] ring-[#cbd5e1]"} px-2 py-0.5 font-mono text-[11px] font-bold ring-1 ring-inset shadow-sm`}
        >
          {value}
          <span className="opacity-50">/10</span>
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={!enabled}
        aria-label={label}
        aria-valuetext={`${value}/10 — ${value <= 3 ? minLabel : value >= 8 ? maxLabel : midLabel}`}
        className="fancy-slider"
        style={{ background: trackGradient }}
      />
      <div className="mt-2 flex justify-between gap-2 text-[10px] leading-tight text-[#475569]">
        <span
          className={`max-w-[45%] transition-colors ${
            enabled && value <= 3 ? "font-semibold text-[#0e7490]" : ""
          }`}
        >
          {minLabel}
        </span>
        <span
          className={`max-w-[45%] text-right transition-colors ${
            enabled && value >= 8 ? "font-semibold text-[#0e7490]" : ""
          }`}
        >
          {maxLabel}
        </span>
      </div>
    </div>
  );
}

// ─── RadioCard ───────────────────────────────────────────────────────────

/** Carte radio (titre + description) — choix inherit/custom du PersonaPanel. */
export function RadioCard({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="radio"
      aria-checked={active}
      className={`group flex items-start gap-2.5 rounded-xl border-2 p-3 text-left transition-all duration-300 ${
        active
          ? "border-[#0e7490] bg-white shadow-[0_4px_16px_-6px_rgba(14,116,144,0.35)]"
          : "border-[#e2e8f0] bg-white/50 hover:-translate-y-0.5 hover:border-[#0e7490]/40 hover:bg-white/90"
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
          active
            ? "border-[#0e7490] bg-[#0e7490]"
            : "border-[#cbd5e1] bg-white group-hover:border-[#0e7490]/60"
        }`}
      >
        {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[#18181b]">{title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-[#475569]">{desc}</p>
      </div>
    </button>
  );
}

// ─── Tag / Stat / Meta ───────────────────────────────────────────────────

/** Valeur en lecture seule (ex. modèle verrouillé côté tenant). */
export function Tag({
  label,
  value,
  lock = false,
}: {
  label: string;
  value: string;
  lock?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#22d3ee]/25 bg-gradient-to-r from-[#ecfeff] to-[#fdf2f8] px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0e7490]">
          {label}
        </p>
        <p className="mt-0.5 truncate font-mono text-xs font-semibold text-[#18181b]">
          {value}
        </p>
      </div>
      {lock && (
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/80 text-[#0e7490]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </span>
      )}
    </div>
  );
}

/** Grande stat du hero (label + valeur colorée). */
export function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "primary" | "cyan" | "teal";
}) {
  const valueColor =
    tone === "primary"
      ? "text-[#be185d]"
      : tone === "cyan"
        ? "text-[#0891b2]"
        : tone === "teal"
          ? "text-[#0e7490]"
          : "text-[#18181b]";
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#475569]">
        {label}
      </p>
      <p
        className={`mt-1 font-display text-2xl font-bold tabular-nums ${valueColor}`}
      >
        {value}
      </p>
    </div>
  );
}

/** Ligne label/valeur de la card statut cyan du hero. */
export function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/60">
        {label}
      </p>
      <p className="truncate font-mono text-sm font-medium">{value}</p>
    </div>
  );
}
