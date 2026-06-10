"use client";

/**
 * ConfigForm — orchestrateur du dashboard de configuration du tenant.
 *
 * Ce fichier ne contient plus que :
 * - l'état global du formulaire (FormState) + le PUT de sauvegarde
 *   (/api/dashboard/config, ou /api/admin/configs/{asUserId} en mode admin)
 * - la grille de tuiles (métadata TILES, ordre persisté en localStorage,
 *   drag & drop) et l'ouverture du workspace de la tuile active
 * - le dock de sauvegarde flottant + la modal d'upsell campagnes
 *
 * Tout le reste est découpé dans app/[locale]/dashboard/config/ :
 * types.ts, formatting.ts, personality-constants.tsx, config-form-css.ts,
 * hero-section.tsx, shared-ui.tsx, les 5 panels (voice/persona/notifs/
 * business/channels) et les sections business (centres, services, modal).
 *
 * Les exports historiques (DEFAULT_BUSINESS, types Business*, AdminBadge…)
 * sont ré-exportés en bas de fichier pour les importeurs externes.
 */

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";

import { LiveTestPanelLK } from "@/components/LiveTestPanelLK";
import type { PromptBlock } from "@/lib/agent-prompt-preview";

import { PromptPreview } from "./prompt-preview";
import { UpsellModal } from "./campaigns/upsell-modal";
import type { PlanFeatures } from "@/lib/plan-features";
import {
  useRealtimeCatalog,
  voicesForCatalog,
} from "@/lib/use-realtime-catalog";

import { BusinessPanel } from "./config/business-panel";
import { ChannelsPanel } from "./config/channels-panel";
import { CONFIG_FORM_CSS } from "./config/config-form-css";
import { HeroSection } from "./config/hero-section";
import { NotifsPanel } from "./config/notifs-panel";
import { PersonaPanel } from "./config/persona-panel";
import {
  PERSONALITY_DEFAULT,
  clamp10,
  speedFromUI,
  tempFromUI,
  uiFromSpeed,
  uiFromTemp,
} from "./config/personality-constants";
import { AddTile, AdminBadge, Tile, type TileDef } from "./config/shared-ui";
import type {
  ChannelNumber,
  DashboardStats,
  FormState,
  Personality,
} from "./config/types";
import { VoicePanel } from "./config/voice-panel";

// ─── Ordre des tuiles (préférence de layout perso, par navigateur) ───────
// L'ordre des tuiles est purement cosmétique → localStorage suffit (pas de
// DB ni d'API). Chaque opérateur réorganise sa propre vue. Les tuiles dont
// l'id n'est pas dans l'ordre mémorisé (ex. tuile admin "prompt" qui
// apparaît conditionnellement) retombent à la fin dans l'ordre par défaut.
const TILE_ORDER_KEY = "tamara.config.tileOrder";

function applyTileOrder<T extends { id: string }>(
  tiles: readonly T[],
  order: string[] | null,
): T[] {
  if (!order) return [...tiles];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...tiles].sort((a, b) => rank(a.id) - rank(b.id));
}

// ─── Component ──────────────────────────────────────────────────────────

export function ConfigForm({
  initial,
  isAdmin = false,
  features,
  adminInheritablePreview = "",
  planLabel = "",
  primaryPhone = null,
  lastUpdatedLabel = "",
  stats,
  asUserId,
  promptBlocks,
  fullPromptConcat,
}: {
  initial: FormState;
  isAdmin?: boolean;
  /** Features actives pour le plan du tenant (gating tuile campagnes).
   *  Absent en mode admin-sur-tenant : le gating retombe alors sur isAdmin. */
  features?: PlanFeatures;
  adminInheritablePreview?: string;
  planLabel?: string;
  primaryPhone?: string | null;
  lastUpdatedLabel?: string;
  stats?: DashboardStats;
  /** Si fourni : mode "admin agissant sur un tenant cible".
   *  - PUT /api/admin/configs/{asUserId} (au lieu de /api/dashboard/config)
   *  - LiveTestPanelLK et autres sous-composants propagent ce userId
   *    pour scoper leurs appels API sur ce tenant. */
  asUserId?: string;
  /** Blocs assemblés du system prompt (admin-only). Quand fournis ET
   *  isAdmin && asUserId, la tuile "Prompt système" est affichée et
   *  permet de voir/éditer chaque bloc per-tenant ou per-plan. */
  promptBlocks?: PromptBlock[];
  fullPromptConcat?: string;
}) {
  const t = useTranslations("DashboardConfig");
  const locale = useLocale();

  const [form, setForm] = useState<FormState>(initial);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [activeTile, setActiveTile] = useState<string | null>(null);

  // Centre d'appels sortant : visible sur tous les plans, mais workspace
  // ouvrable seulement si la feature est active (plan premium) OU admin.
  // Sinon clic → modal d'upsell.
  const campaignsEnabled = isAdmin || features?.outbound_campaigns === true;
  const [upsellOpen, setUpsellOpen] = useState(false);

  // Ordre des tuiles : null tant que pas hydraté depuis localStorage (évite
  // un flash d'ordre par défaut → réordonné côté client au 1er paint).
  const [tileOrder, setTileOrder] = useState<string[] | null>(null);
  const [dragTileId, setDragTileId] = useState<string | null>(null);
  const [dragOverTileId, setDragOverTileId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TILE_ORDER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string"))
          // eslint-disable-next-line react-hooks/set-state-in-effect -- hydratation localStorage post-mount (SSR-safe), pattern voulu
          setTileOrder(parsed);
      }
    } catch {
      /* localStorage indispo / JSON corrompu → ordre par défaut */
    }
  }, []);

  const persistTileOrder = (ids: string[]) => {
    setTileOrder(ids);
    try {
      localStorage.setItem(TILE_ORDER_KEY, JSON.stringify(ids));
    } catch {
      /* quota / mode privé → l'ordre reste valable pour la session */
    }
  };

  // Compteurs canaux (PSTN / WhatsApp) pour le résumé de la tuile "Canaux".
  // Chargés une fois au montage depuis /api/dashboard/channels (scope via
  // asUserId en mode admin). channelsLoaded gate l'affichage du summary
  // chiffré vs le tagline statique tant que le fetch n'a pas répondu.
  const [channelCounts, setChannelCounts] = useState<{
    pstn: number;
    whatsapp: number;
  }>({ pstn: 0, whatsapp: 0 });
  const [channelsLoaded, setChannelsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const url = asUserId
      ? `/api/dashboard/channels?asUserId=${encodeURIComponent(asUserId)}`
      : "/api/dashboard/channels";
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: { numbers?: ChannelNumber[] }) => {
        if (cancelled) return;
        const nums = data.numbers ?? [];
        setChannelCounts({
          pstn: nums.filter((n) => n.channel === "pstn").length,
          whatsapp: nums.filter((n) => n.channel === "whatsapp").length,
        });
        setChannelsLoaded(true);
      })
      .catch(() => {
        /* silencieux : la tuile retombe sur le tagline statique */
      });
    return () => {
      cancelled = true;
    };
  }, [asUserId]);

  const catalog = useRealtimeCatalog();
  const availableVoices = useMemo(
    () => voicesForCatalog(catalog, form.model),
    [catalog, form.model],
  );

  // Labels langues traduits stables (refs).
  const primaryLanguages = useMemo(
    () => [
      { value: "fr", flag: "FR", label: t("langFr") },
      { value: "he", flag: "HE", label: t("langHe") },
      { value: "en", flag: "EN", label: t("langEn") },
    ],
    [t],
  );
  const currentLangLabel =
    primaryLanguages.find((l) => l.value === form.primaryLanguage)?.label ??
    form.primaryLanguage;
  const currentLangFlag =
    primaryLanguages.find((l) => l.value === form.primaryLanguage)?.flag ?? "—";

  // Récupère valeur UI 1-10 pour un slider personality (avec mappings spéciaux
  // pour vitesse/créativité qui sont stockés dans form.speed/form.temperature).
  const getPersonalityValue = (key: string): number => {
    if (key === "vitesse") return clamp10(uiFromSpeed(form.speed));
    if (key === "creativite") return clamp10(uiFromTemp(form.temperature));
    return clamp10(form.personality[key as keyof Personality] ?? 5);
  };

  const setPersonalityValue = (key: string, ui: number) => {
    setDirty(true);
    setForm((prev) => {
      const ui10 = clamp10(ui);
      if (key === "vitesse") {
        return { ...prev, speed: speedFromUI(ui10) };
      }
      if (key === "creativite") {
        return { ...prev, temperature: tempFromUI(ui10) };
      }
      return {
        ...prev,
        personality: { ...prev.personality, [key]: ui10 },
      };
    });
  };

  const resetPersonality = () => {
    setDirty(true);
    setForm((prev) => ({
      ...prev,
      speed: speedFromUI(PERSONALITY_DEFAULT.vitesse!),
      temperature: tempFromUI(PERSONALITY_DEFAULT.creativite!),
      personality: { ...PERSONALITY_DEFAULT },
    }));
  };

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setDirty(true);
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "model") {
        const allowed = voicesForCatalog(catalog, value as string);
        if (!allowed.includes(prev.voice) && allowed.length > 0) {
          next.voice = allowed[0]!;
        }
      }
      return next;
    });
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const endpoint = asUserId
        ? `/api/admin/configs/${asUserId}`
        : "/api/dashboard/config";
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? t("errSaveFailed"));
        return;
      }
      const timeLocale =
        locale === "he" ? "he-IL" : locale === "en" ? "en-US" : "fr-FR";
      setSavedAt(new Date().toLocaleTimeString(timeLocale));
      setDirty(false);
    });
  };

  // ─── TILES — métadata + summary dynamiques ───────────────────────────
  const TILES = [
    {
      id: "voice",
      label: t("voiceTitle"),
      tagline: t("wowTagVoice"),
      summary: `${form.voice} · ${getPersonalityValue("vitesse")}/10`,
      accent: "from-[#06b6d4] to-[#0e7490]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      ),
    },
    {
      id: "business",
      label: t("businessTileLabel"),
      tagline: t("businessTileTagline"),
      summary: t("businessTileSummary", {
        centres: form.business.centres.length,
        services: form.business.services.length,
      }),
      accent: "from-[#f59e0b] to-[#b45309]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2h-4a1 1 0 0 1-1-1v-5h-4v5a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2z" />
        </svg>
      ),
    },
    {
      id: "persona",
      label: t("personaTitle"),
      tagline: t("wowTagPersona"),
      summary: `${form.inheritAdminGlobals ? t("wowPersonaSummaryInherit") : t("wowPersonaSummaryCustom")} · ${currentLangFlag}`,
      accent: "from-[#be185d] to-[#ec4899]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      ),
    },
    {
      id: "notifs",
      label: t("wowTileNotifs"),
      tagline: t("wowTagNotifs"),
      summary: form.ownerWhatsapp ? t("wowNotifsSummaryActive") : t("wowNotifsSummaryInactive"),
      accent: "from-[#22d3ee] to-[#0e7490]",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
      ),
    },
    {
      id: "channels",
      label: t("channelsTile"),
      tagline: t("channelsTileTagline"),
      summary: channelsLoaded
        ? t("channelsTileSummary", {
            pstn: channelCounts.pstn,
            wa: channelCounts.whatsapp,
          })
        : t("channelsTileTagline"),
      accent: "from-[#25D366] to-[#128C7E]",
      adminOnly: false,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    // Tuile "Centre d'appels sortant" — TOUJOURS visible (tous les plans),
    // mais verrouillée hors premium/admin (clic → upsell). Premier pattern
    // "shown-but-locked" du dashboard. Workspace = modal plein écran.
    {
      id: "campaigns" as const,
      label: t("campaignsTileLabel"),
      tagline: t("campaignsTileTagline"),
      summary: campaignsEnabled
        ? t("campaignsTileSummary")
        : t("campaignsTileLocked"),
      accent: "from-[#f97316] to-[#db2777]",
      locked: !campaignsEnabled,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M3 11l18-5v12L3 14v-3z" />
          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
        </svg>
      ),
    },
    // Tuile admin-only — apparaît dans /admin/users/[id] uniquement
    // (gated par `isAdmin && asUserId && promptBlocks`). Voir
    // dashboard_admin_shared_form.md : features admin-only restent
    // dans ConfigForm gatées plutôt que dans un form parallèle.
    ...(isAdmin && asUserId && promptBlocks && promptBlocks.length > 0
      ? [
          {
            id: "prompt" as const,
            label: "Prompt système",
            tagline: "Voir et éditer chaque bloc du prompt envoyé à l'agent",
            summary: `${promptBlocks.length} blocs · ${(fullPromptConcat ?? "").length} chars`,
            accent: "from-[#7c3aed] to-[#4c1d95]",
            adminOnly: true,
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="13" x2="15" y2="13" />
                <line x1="9" y1="17" x2="15" y2="17" />
                <line x1="9" y1="9" x2="11" y2="9" />
              </svg>
            ),
          },
        ]
      : []),
  ] as const;

  // Tuiles dans l'ordre choisi par l'opérateur (cf. applyTileOrder).
  // Quand les appels sortants sont activés (premium/admin), la tuile campagnes
  // disparaît de la grille : la feature a son propre onglet de nav « Appels
  // sortants ». On ne garde la tuile que verrouillée (upsell) pour les plans
  // non éligibles, comme point de découverte.
  const orderedTiles = applyTileOrder(TILES, tileOrder).filter(
    (tile) => tile.id !== "campaigns" || !campaignsEnabled,
  );

  // Drag & drop natif HTML5 (même pattern que admin/block-order-form), mais
  // sur une grille → on raisonne par id de tuile, pas par index. Le drop
  // retire la tuile draggée et la réinsère devant la tuile cible.
  const onTileDrop = (targetId: string) => {
    if (!dragTileId || dragTileId === targetId) {
      setDragTileId(null);
      setDragOverTileId(null);
      return;
    }
    const ids: string[] = orderedTiles.map((tile) => tile.id);
    const from = ids.indexOf(dragTileId);
    const to = ids.indexOf(targetId);
    setDragTileId(null);
    setDragOverTileId(null);
    if (from === -1 || to === -1) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    persistTileOrder(next);
  };

  return (
    <form onSubmit={onSubmit} className="relative pb-24">
      {/* Aurora mesh global est dans le DashboardLayout (couvre tout
       * /dashboard/*). Ici seulement les animations locales
       * (keyframes + classes partagées, voir config/config-form-css.ts). */}

      <style>{CONFIG_FORM_CSS}</style>

      {/* Layout 2 colonnes à partir de xl (1280px+) :
       *  - Hero span 2 colonnes en haut (full width).
       *  - LiveTest dans la colonne droite, row 2, position sticky :
       *    démarre en bas du viewport sous le hero, puis ne monte pas plus
       *    haut que le centre quand on scroll.
       *  - Tile section dans la colonne gauche row 2.
       *  En dessous de xl : ordre DOM (hero → LiveTest → tiles), comportement
       *  inline classique sans sticky. */}
      <div className="relative xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-8">
        {/* ── HERO + LIVE STATUS ──────────────────────────────────────── */}
        <HeroSection
          primaryPhone={primaryPhone}
          asUserId={asUserId}
          stats={stats}
          lastUpdatedLabel={lastUpdatedLabel}
          planLabel={planLabel}
          voice={form.voice}
          currentLangLabel={currentLangLabel}
        />

        {/* ── LIVE TEST ───────────────────────────────────────────────── */}
        {/* < xl : inline sous le hero (comportement historique).
         *  xl+  : positionné dans la col droite, row 2. Le wrapper interne
         *         est sticky avec top:50vh → le panel scroll naturellement
         *         depuis sa position de départ (sous le hero), puis se fige
         *         à mi-écran et reste visible pendant le scroll. */}
        <aside className="card-hover anim-fade-up mb-8 xl:col-start-2 xl:row-start-2 xl:mb-0">
          {/* Trick centrage vertical sans overlap avec le hero :
           *  - xl:mt-[280px] décale la position naturelle vers le bas de
           *    ≈ moitié de la hauteur du panel.
           *  - xl:-translate-y-1/2 décale ensuite visuellement vers le haut
           *    de 50% de la hauteur du panel.
           *  Au repos : ces deux décalages s'annulent → panel pile sous le
           *  hero (jamais d'overlap avec la box statut).
           *  Pendant le scroll : sticky top:50vh + translate = centre du
           *  panel calé sur le centre du viewport. */}
          <div className="xl:mt-[280px] xl:sticky xl:top-[50vh] xl:-translate-y-1/2">
            <LiveTestPanelLK dirty={dirty} asUserId={asUserId} />
          </div>
        </aside>

        {/* ── TILE GRID ───────────────────────────────────────────────── */}
        <section className="mb-6 xl:col-start-1 xl:row-start-2">
          <div className="mb-4">
            <h2 className="text-xl font-extrabold tracking-tight text-[#18181b] sm:text-2xl">
              {t("header")}
            </h2>
            <p className="mt-1 text-sm text-[#475569]">
              {activeTile ? t("wowTileHintActive") : t("wowTileHintIdle")}
            </p>
            <p className="mt-0.5 hidden text-xs text-[#94a3b8] sm:block">
              {t("wowTileReorderHint")}
            </p>
          </div>

          {/* À partir de xl, la grille des tuiles n'a plus toute la largeur
           *  (la col droite contient le LiveTest sticky), donc on repasse
           *  à 4 colonnes pour que les tuiles ne deviennent pas trop petites. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-4">
            {orderedTiles.map((tile, i) => (
              <Tile
                key={tile.id}
                tile={tile}
                active={activeTile === tile.id}
                onClick={() => {
                  // La tuile campagnes n'apparaît que verrouillée (plans non
                  // éligibles) → elle ouvre l'upsell. Les plans éligibles
                  // passent par l'onglet de nav « Appels sortants ».
                  if (tile.id === "campaigns") {
                    setUpsellOpen(true);
                    return;
                  }
                  setActiveTile((curr) => (curr === tile.id ? null : tile.id));
                }}
                delay={300 + i * 60}
                dragging={dragTileId === tile.id}
                dropTarget={dragOverTileId === tile.id && dragTileId !== tile.id}
                onDragStart={() => setDragTileId(tile.id)}
                onDragEnter={() => {
                  if (dragTileId && dragTileId !== tile.id)
                    setDragOverTileId(tile.id);
                }}
                onDrop={() => onTileDrop(tile.id)}
                onDragEnd={() => {
                  setDragTileId(null);
                  setDragOverTileId(null);
                }}
              />
            ))}
            <AddTile delay={300 + orderedTiles.length * 60} />
          </div>

          {activeTile && (
            <div
              key={activeTile}
              className="anim-fade-up mt-5 overflow-hidden rounded-[2rem] border border-white/40 bg-white/70 shadow-[0_4px_24px_-8px_rgba(190,24,93,0.15)] backdrop-blur-xl"
            >
              <header className="flex items-center justify-between gap-3 border-b border-[#e2e8f0] bg-gradient-to-br from-white/60 to-white/30 px-6 py-4 sm:px-8">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${TILES.find((t) => t.id === activeTile)?.accent} text-white shadow-md`}
                  >
                    {TILES.find((t) => t.id === activeTile)?.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-extrabold tracking-tight text-[#18181b] sm:text-xl">
                        {TILES.find((t) => t.id === activeTile)?.label}
                      </h3>
                      {(TILES.find((t) => t.id === activeTile) as TileDef | undefined)?.adminOnly && (
                        <AdminBadge size="sm" />
                      )}
                    </div>
                    <p className="truncate text-xs text-[#475569]">
                      {TILES.find((t) => t.id === activeTile)?.summary}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTile(null)}
                  aria-label={t("wowCloseAria")}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/80 text-[#475569] transition-all hover:bg-[#fee2e2] hover:text-[#dc2626] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490]"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-4 w-4">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </header>

              <div className="px-6 py-6 sm:px-8 sm:py-7">
                {activeTile === "voice" && (
                  <VoicePanel
                    form={form}
                    update={update}
                    availableVoices={availableVoices}
                    isAdmin={isAdmin}
                    catalogModels={catalog.models}
                    getPersonalityValue={getPersonalityValue}
                    setPersonalityValue={setPersonalityValue}
                    resetPersonality={resetPersonality}
                  />
                )}
                {activeTile === "persona" && (
                  <PersonaPanel
                    form={form}
                    update={update}
                    primaryLanguages={primaryLanguages}
                    adminInheritablePreview={adminInheritablePreview}
                    planLabel={planLabel}
                    t={t}
                  />
                )}
                {activeTile === "notifs" && (
                  <NotifsPanel form={form} update={update} t={t} />
                )}
                {activeTile === "business" && (
                  <BusinessPanel form={form} update={update} t={t} />
                )}
                {activeTile === "channels" && (
                  <ChannelsPanel t={t} asUserId={asUserId} />
                )}
                {activeTile === "prompt" &&
                  isAdmin &&
                  asUserId &&
                  promptBlocks && (
                    <PromptPreview
                      blocks={promptBlocks}
                      fullPrompt={fullPromptConcat ?? ""}
                      userId={asUserId}
                    />
                  )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ── Floating save dock — aligné sur le visuel wow ───────────── */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-6">
        <div
          className="pointer-events-auto flex items-center gap-4 rounded-full border border-white/50 bg-white/85 px-2 py-2 pl-5 shadow-[0_12px_40px_-8px_rgba(190,24,93,0.25)] backdrop-blur-xl anim-fade-up"
          style={{ animationDelay: "700ms" }}
        >
          <span className="inline-flex items-center gap-2 text-xs font-medium text-[#831843]">
            {error ? (
              <span className="font-semibold text-[#dc2626]">{error}</span>
            ) : dirty ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#be185d]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#be185d] motion-safe:animate-pulse" />
                {t("unsavedChanges")}
              </span>
            ) : savedAt ? (
              <span className="inline-flex items-center gap-1.5 text-[#0e7490]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#22d3ee]" />
                {t("savedAt", { time: savedAt })}
              </span>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-[#22d3ee] motion-safe:animate-pulse" />
                {t("upToDate")}
              </>
            )}
          </span>
          <button
            type="submit"
            disabled={isPending}
            className="group rounded-full bg-gradient-to-br from-[#be185d] to-[#ec4899] px-5 py-2 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.03] hover:shadow-lg active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="inline-flex items-center gap-1.5">
              {isPending ? t("saving") : t("saveButton")}
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5">
                <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        </div>
      </div>

      {/* Centre d'appels sortant — pour les plans éligibles (premium/admin),
       *  la feature vit dans l'onglet de nav « Appels sortants »
       *  (/dashboard/campaigns). Ici, seule reste la modal d'upsell déclenchée
       *  par la tuile verrouillée des plans inférieurs. */}
      <UpsellModal open={upsellOpen} onClose={() => setUpsellOpen(false)} />
    </form>
  );
}

// ─── Ré-exports historiques ──────────────────────────────────────────────
// Les importeurs externes (dashboard/page, dashboard-preview, admin/users/
// [userId], website-scan-wizard) continuent d'importer depuis
// "./config-form" — on ré-exporte donc les symboles déplacés vers config/.

export type {
  BusinessCentre,
  BusinessConfig,
  BusinessService,
  ChannelNumber,
  DayHours,
  WeekDay,
  WeeklyHours,
} from "./config/types";
export { DEFAULT_BUSINESS } from "./config/types";
export { AdminBadge } from "./config/shared-ui";
