"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { LiveTestPanelLK } from "@/components/LiveTestPanelLK";
import type { PromptBlock } from "@/lib/agent-prompt-preview";

import { PromptPreview } from "./prompt-preview";
import { WebsiteScanWizard } from "./website-scan-wizard";
import { CampaignsWorkspace } from "./campaigns/campaigns-workspace";
import { UpsellModal } from "./campaigns/upsell-modal";
import type { PlanFeatures } from "@/lib/plan-features";
import { PERSONALITY_KEYS } from "@/lib/personality";
import {
  useRealtimeCatalog,
  voicesForCatalog,
} from "@/lib/use-realtime-catalog";

// ─── Types ──────────────────────────────────────────────────────────────

type Personality = Partial<Record<(typeof PERSONALITY_KEYS)[number], number>>;

type FormState = {
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
  personality: Personality;
  agentName: string;
  /** Slider 1-10 piloté ici, envoyé tel quel au PUT puis exposé à
   *  /api/agent/config pour le worker qui le mappe en enhancementLevel 0.1-1.0
   *  du QVF 2.1 L (ai-coustics). 1 = passthrough, 8 = équilibré, 10 = agressif. */
  noiseReductionLevel: number;
  /** Structure métier du tenant : identité + centres (avec horaires hebdo) +
   *  soins/tarifs. Remplace l'ancienne `knowledge` libre — exposé tel quel
   *  au worker via /api/agent/config qui en dérive les tools dynamiques. */
  business: BusinessConfig;
};

export type WeekDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type DayHours = {
  open: boolean;
  openTime: string;
  closeTime: string;
};

export type WeeklyHours = Record<WeekDay, DayHours>;

export type BusinessCentre = {
  id: string;
  name: string;
  address: string;
  hours: WeeklyHours;
};

export type BusinessService = {
  id: string;
  name: string;
  durationMinutes: number;
  priceILS: number;
  /** "all" sentinel = dispo dans tous les centres ; sinon liste d'IDs. */
  centreIds: string[] | "all";
  description: string;
};

export type BusinessConfig = {
  identity: { name: string; tagline: string; email: string };
  centres: BusinessCentre[];
  services: BusinessService[];
  /** Texte libre optionnel injecté dans le system prompt sous une section
   *  "Centers and Days Rules (STRICT — NON-NEGOTIABLE)". Permet au tenant
   *  d'encoder ses contraintes métier non-représentables par le grid horaires
   *  (ex. "Natanya uniquement le mercredi", blackout dates, etc.).
   *  Vide → la section n'est pas injectée du tout. */
  centresRules?: string;
};

/** Un numéro tenant tel que renvoyé par /api/dashboard/channels — le canal
 *  est dérivé du préfixe `whatsapp:` côté serveur et phoneNumber est déjà
 *  nettoyé pour l'affichage. */
export type ChannelNumber = {
  id: string;
  phoneNumber: string;
  channel: "pstn" | "whatsapp";
  label: string;
  countryCode: string;
};

const WEEKDAY_ORDER: readonly WeekDay[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;

const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  mon: { open: true, openTime: "09:00", closeTime: "18:00" },
  tue: { open: true, openTime: "09:00", closeTime: "18:00" },
  wed: { open: true, openTime: "09:00", closeTime: "18:00" },
  thu: { open: true, openTime: "09:00", closeTime: "18:00" },
  fri: { open: true, openTime: "09:00", closeTime: "14:00" },
  sat: { open: false, openTime: "09:00", closeTime: "18:00" },
  sun: { open: true, openTime: "09:00", closeTime: "18:00" },
};

export const DEFAULT_BUSINESS: BusinessConfig = {
  identity: { name: "", tagline: "", email: "" },
  centres: [],
  services: [],
  centresRules: "",
};

type Gender = "f" | "m";

// ─── Constants ──────────────────────────────────────────────────────────

// Genre par défaut pour chaque voix OpenAI Realtime — utilisé pour colorer
// la card (rose = féminine, cyan = masculine). Liste alignée avec
// PROVIDERS.openai.voices dans lib/realtime.ts.
const VOICE_GENDER: Record<string, Gender> = {
  marin: "f",
  ballad: "m",
  sage: "f",
  verse: "m",
  alloy: "m",
  shimmer: "f",
  echo: "m",
  fable: "m",
  onyx: "m",
  nova: "f",
  coral: "f",
  ash: "m",
};

// Voice IDs — descriptions traduites construites dynamiquement via t() côté
// composant (voir useMemo `voiceDescMap` plus bas).
const VOICE_IDS = [
  "marin", "ballad", "sage", "verse", "alloy", "shimmer",
  "echo", "fable", "onyx", "nova", "coral", "ash",
] as const;

// 9 dimensions de personnalité — 3 branchées E2E (vitesse → speed,
// creativite → temperature, reactivite → VAD silence_duration_ms côté
// /api/session), 6 autres en preview UI seulement (DB persisté mais agent
// vocal ne les consomme pas encore).
//
// Module-level : SEULEMENT les icons/anim/enabled/badge. Les labels sont
// construits dynamiquement via t() dans le composant (voir `sliderDefs`).
const PERSONALITY_SLIDER_META = [
  { key: "vitesse", anim: "anim-slide-x", enabled: true, badge: "OpenAI", icon: (
    <>
      <polygon points="13 19 22 12 13 5 13 19" />
      <polygon points="2 19 11 12 2 5 2 19" />
    </>
  ) },
  { key: "creativite", anim: "anim-sparkle", enabled: true, badge: "OpenAI", icon: (
    <path d="M12 3l1.9 5.8L20 10l-5 4.8 1.5 6.2L12 17.8 7.5 21 9 14.8 4 10l6.1-1.2z" />
  ) },
  { key: "reactivite", anim: "anim-pulse-quick", enabled: true, badge: "VAD", icon: (
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  ) },
  { key: "joie", anim: "anim-bounce-soft", enabled: false, badge: undefined as string | undefined, icon: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </>
  ) },
  { key: "empathie", anim: "anim-pulse-soft", enabled: false, badge: undefined as string | undefined, icon: (
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  ) },
  { key: "dynamisme", anim: "anim-flash", enabled: false, badge: undefined as string | undefined, icon: (
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  ) },
  { key: "professionnel", anim: "anim-tilt", enabled: false, badge: undefined as string | undefined, icon: (
    <>
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </>
  ) },
  { key: "humour", anim: "anim-wiggle", enabled: false, badge: undefined as string | undefined, icon: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M7 13a5 5 0 0 0 10 0" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </>
  ) },
  { key: "accent", anim: "anim-spin-slow", enabled: false, badge: undefined as string | undefined, icon: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>
  ) },
] as const;

// Capitalize first letter for i18n key construction (key "vitesse" → "Vitesse").
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const PERSONALITY_DEFAULT: Personality = {
  vitesse: 5,
  creativite: 5,
  reactivite: 5,
  joie: 6,
  empathie: 8,
  dynamisme: 7,
  professionnel: 7,
  humour: 4,
  accent: 3,
};

// Mappings entre l'échelle UI 1-10 et les valeurs API OpenAI réelles.
// Speed : 0.5x → 1.5x sur l'API, 1 → 10 côté UI (5 = 1.0x baseline).
// Temperature : 0 → 1.5 sur l'API, 1 → 10 côté UI.
// Réactivité : la valeur 1-10 est passée telle quelle à /api/session
// qui calcule silence_duration_ms (1200ms → 200ms).
const speedFromUI = (ui: number) => 0.5 + ((ui - 1) / 9) * 1.0; // 0.5..1.5
const uiFromSpeed = (api: number) => Math.round(((api - 0.5) / 1.0) * 9 + 1);
const tempFromUI = (ui: number) => ((ui - 1) / 9) * 1.5; // 0..1.5
const uiFromTemp = (api: number) => Math.round((api / 1.5) * 9 + 1);

const clamp10 = (n: number) => Math.min(10, Math.max(1, Math.round(n)));

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

type DashboardStats = {
  callsToday: number;
  conversion: number;
  avgDuration: string;
  rdv: number;
  minutesThisMonth: number;
};

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
  const [campaignsOpen, setCampaignsOpen] = useState(false);
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
  const orderedTiles = applyTileOrder(TILES, tileOrder);

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
       * /dashboard/*). Ici seulement les animations locales. */}

      <style>{`
        @keyframes wave {
          0%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(0.3); }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes bounce-in {
          0% { opacity: 0; transform: scale(0.92); }
          60% { transform: scale(1.02); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .anim-fade-up { animation: fade-up 0.6s ease-out backwards; }
        .anim-bounce-in { animation: bounce-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) backwards; }
        .card-hover {
          transition: transform 350ms cubic-bezier(0.16, 1, 0.3, 1),
                      box-shadow 350ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .card-hover:hover {
          transform: translateY(-4px);
          box-shadow: 0 16px 48px -16px rgba(190, 24, 93, 0.30);
        }
        @keyframes bounce-soft { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
        @keyframes pulse-soft { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); } }
        @keyframes flash-soft {
          0%,100% { opacity: 1; transform: scale(1); }
          15% { opacity: 0.5; transform: scale(0.92); }
          30% { opacity: 1; transform: scale(1); }
        }
        @keyframes slide-x { 0%,100% { transform: translateX(0); } 50% { transform: translateX(3px); } }
        @keyframes tilt { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
        @keyframes sparkle {
          0%,100% { transform: scale(1) rotate(0deg); opacity: 1; }
          50% { transform: scale(1.2) rotate(20deg); opacity: 0.85; }
        }
        @keyframes wiggle { 0%,100% { transform: rotate(0deg); } 25% { transform: rotate(-10deg); } 75% { transform: rotate(10deg); } }
        @keyframes pulse-quick {
          0%,100% { transform: scale(1); }
          25% { transform: scale(1.2); }
          50% { transform: scale(0.95); }
          75% { transform: scale(1.1); }
        }
        @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .anim-bounce-soft { animation: bounce-soft 2.4s ease-in-out infinite; }
        .anim-pulse-soft  { animation: pulse-soft 1.6s ease-in-out infinite; }
        .anim-flash       { animation: flash-soft 3s ease-in-out infinite; }
        .anim-slide-x     { animation: slide-x 1.4s ease-in-out infinite; }
        .anim-tilt        { animation: tilt 4s ease-in-out infinite; }
        .anim-sparkle     { animation: sparkle 2.8s ease-in-out infinite; }
        .anim-wiggle      { animation: wiggle 2s ease-in-out infinite; }
        .anim-pulse-quick { animation: pulse-quick 1.2s ease-in-out infinite; }
        .anim-spin-slow   { animation: spin-slow 8s linear infinite; }
        @keyframes ripple-ring {
          0%   { transform: scale(0.85); opacity: 0.55; }
          70%  { opacity: 0; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        .ripple-ring {
          position: absolute; inset: 0; border-radius: 9999px;
          border: 2px solid #22d3ee; pointer-events: none;
          animation: ripple-ring 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite;
        }
        .ripple-ring--2 { animation-delay: 0.8s; }
        .ripple-ring--3 { animation-delay: 1.6s; }
        .fancy-slider {
          -webkit-appearance: none; appearance: none;
          height: 8px; width: 100%; border-radius: 9999px;
          outline: none; background: transparent;
        }
        .fancy-slider::-webkit-slider-runnable-track {
          height: 8px; border-radius: 9999px; background: inherit;
        }
        .fancy-slider::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 22px; height: 22px; margin-top: -7px;
          border-radius: 50%;
          background: linear-gradient(135deg, #22d3ee 0%, #0e7490 100%);
          border: 3px solid #ffffff;
          box-shadow: 0 2px 8px -1px rgba(14, 116, 144, 0.45),
                      0 0 0 1px rgba(14, 116, 144, 0.18);
          cursor: grab;
          transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1),
                      box-shadow 220ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .fancy-slider:hover::-webkit-slider-thumb {
          transform: scale(1.15);
          box-shadow: 0 4px 16px -2px rgba(14, 116, 144, 0.5),
                      0 0 0 6px rgba(34, 211, 238, 0.18);
        }
        .fancy-slider:active::-webkit-slider-thumb,
        .fancy-slider:focus::-webkit-slider-thumb {
          cursor: grabbing; transform: scale(1.25);
          box-shadow: 0 4px 20px -2px rgba(14, 116, 144, 0.6),
                      0 0 0 8px rgba(34, 211, 238, 0.22);
        }
        .fancy-slider::-moz-range-track {
          height: 8px; border-radius: 9999px; background: inherit; border: none;
        }
        .fancy-slider::-moz-range-thumb {
          width: 22px; height: 22px; border-radius: 50%;
          background: linear-gradient(135deg, #22d3ee 0%, #0e7490 100%);
          border: 3px solid #ffffff;
          box-shadow: 0 2px 8px -1px rgba(14, 116, 144, 0.45);
          cursor: grab; transition: transform 220ms, box-shadow 220ms;
        }
        .fancy-slider:disabled { opacity: 0.5; cursor: not-allowed; }
        .fancy-slider:disabled::-webkit-slider-thumb { cursor: not-allowed; }
        @keyframes drawer-slide-in {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        .drawer-anim { animation: drawer-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes modal-pop {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
        .modal-anim { animation: modal-pop 0.2s ease-out; }
        @keyframes overlay-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .overlay-anim { animation: overlay-fade 0.2s ease-out; }
        @media (prefers-reduced-motion: reduce) {
          .anim-fade-up, .anim-bounce-in, .anim-bounce-soft, .anim-pulse-soft,
          .anim-flash, .anim-slide-x, .anim-tilt, .anim-sparkle, .anim-wiggle,
          .anim-pulse-quick, .anim-spin-slow, .ripple-ring,
          .drawer-anim, .modal-anim, .overlay-anim { animation: none; }
          .card-hover { transition: none; }
          .card-hover:hover { transform: none; }
        }
      `}</style>

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
        <section className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-12 xl:col-span-2">
          <div
            className="card-hover anim-fade-up relative overflow-hidden rounded-[2rem] border border-white/40 bg-white/55 p-7 shadow-[0_8px_40px_-12px_rgba(190,24,93,0.25)] backdrop-blur-xl sm:p-10 lg:col-span-8"
            style={{ animationDelay: "60ms" }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full bg-gradient-to-br from-[#22d3ee]/30 to-[#ec4899]/20 blur-3xl motion-safe:animate-[aurora_15s_ease-in-out_infinite]"
            />

            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[#be185d]">
              {t("heroEyebrow")} ·{" "}
              <span className="inline-flex items-center gap-1 text-[#0e7490]">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[#22d3ee] opacity-70 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22d3ee]" />
                </span>
                {t("heroLive")}
              </span>
            </p>

            {primaryPhone ? (
              <p
                className="mt-4 break-words bg-gradient-to-r from-[#0e7490] via-[#be185d] to-[#ec4899] bg-clip-text font-display text-4xl font-bold leading-[0.95] tracking-tight tabular-nums text-transparent drop-shadow-[0_2px_24px_rgba(190,24,93,0.18)] sm:text-6xl"
                style={{
                  fontFeatureSettings: '"tnum"',
                  backgroundSize: "200% 100%",
                  animation: "shimmer 8s linear infinite",
                }}
              >
                {primaryPhone}
              </p>
            ) : (
              <p className="mt-4 text-base text-[#475569]">{t("heroNoPhone")}</p>
            )}

            {stats && (
              <div className="mt-8 flex flex-wrap gap-x-8 gap-y-4 border-t border-[#fbcfe8]/60 pt-6">
                <Stat
                  label={t("wowStatCallsToday")}
                  value={stats.callsToday.toString()}
                  tone="cyan"
                />
                <Stat
                  label={t("wowStatMinutesMonth")}
                  value={`${stats.minutesThisMonth} min`}
                  tone="cyan"
                />
                <Stat
                  label={t("wowStatConversion")}
                  value={`${stats.conversion}%`}
                  tone="teal"
                />
                <Stat
                  label={t("wowStatAvgDuration")}
                  value={stats.avgDuration}
                  tone="teal"
                />
                <Stat
                  label={t("wowStatRdv")}
                  value={stats.rdv.toString()}
                  tone="primary"
                />
              </div>
            )}

            {lastUpdatedLabel && (
              <p className="mt-3 text-xs text-[#475569]">
                {t("lastUpdated")} {lastUpdatedLabel}
              </p>
            )}
          </div>

          {/* Statut card cyan */}
          <div
            className="card-hover anim-fade-up relative flex flex-col gap-5 overflow-hidden rounded-[2rem] border border-white/40 bg-gradient-to-br from-[#0891b2] via-[#0e7490] to-[#155e75] p-7 text-white shadow-[0_8px_40px_-12px_rgba(14,116,144,0.4)] lg:col-span-4"
            style={{ animationDelay: "140ms" }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-12 -right-12 h-48 w-48 rounded-full bg-white/15 blur-2xl"
            />

            <div className="relative flex items-start justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/70">
                {t("wowStatusLabel")}
              </p>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#22d3ee]/20 px-2.5 py-1 text-[10px] font-semibold text-[#a5f3fc] ring-1 ring-inset ring-[#22d3ee]/40 backdrop-blur">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[#22d3ee] opacity-80 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22d3ee]" />
                </span>
                {t("wowLiveLabel")}
              </span>
            </div>

            {/* Waveform alterné blanc/cyan */}
            <div className="relative flex h-28 items-center justify-center gap-1.5">
              {Array.from({ length: 14 }).map((_, i) => (
                <span
                  key={i}
                  className="w-1 rounded-full motion-safe:animate-[wave_1.2s_ease-in-out_infinite]"
                  style={{
                    height: `${20 + Math.sin(i * 0.8) * 30 + 30}%`,
                    animationDelay: `${i * 80}ms`,
                    backgroundColor: i % 2 === 0 ? "rgba(255,255,255,0.9)" : "#22d3ee",
                    boxShadow: i % 2 === 1 ? "0 0 8px rgba(34,211,238,0.6)" : "none",
                  }}
                />
              ))}
            </div>

            <div className="relative space-y-2.5">
              <Meta label={t("heroVoiceLabel")} value={form.voice} />
              <Meta label={t("heroLanguageLabel")} value={currentLangLabel} />
              <Meta label={t("wowPlanLabel")} value={planLabel || "—"} />
            </div>
          </div>
        </section>

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
                  // La tuile campagnes ouvre un workspace modal (ou l'upsell
                  // si verrouillée), pas le panneau inline classique.
                  if (tile.id === "campaigns") {
                    if (campaignsEnabled) setCampaignsOpen(true);
                    else setUpsellOpen(true);
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

      {/* Centre d'appels sortant — workspace plein écran (premium/admin) ou
       *  modal d'upsell (plans inférieurs). Montés au niveau racine du form
       *  pour s'afficher en overlay au-dessus de toute la config. */}
      {campaignsEnabled && (
        <CampaignsWorkspace
          open={campaignsOpen}
          onClose={() => setCampaignsOpen(false)}
          asUserId={asUserId}
        />
      )}
      <UpsellModal open={upsellOpen} onClose={() => setUpsellOpen(false)} />
    </form>
  );
}

// ─── Tile + AddTile ─────────────────────────────────────────────────────

type TileDef = {
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

function Tile({
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

function AddTile({ delay = 0 }: { delay?: number }) {
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

// ─── Panels ─────────────────────────────────────────────────────────────

function VoicePanel({
  form,
  update,
  availableVoices,
  isAdmin,
  catalogModels,
  getPersonalityValue,
  setPersonalityValue,
  resetPersonality,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  availableVoices: ReadonlyArray<string>;
  isAdmin: boolean;
  catalogModels: ReadonlyArray<{ id: string; provider: string }>;
  getPersonalityValue: (key: string) => number;
  setPersonalityValue: (key: string, ui: number) => void;
  resetPersonality: () => void;
}) {
  const t = useTranslations("DashboardConfig");

  // Maps traduits dynamiquement (dépendent de la locale active).
  const voiceDescMap = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const v of VOICE_IDS) {
      const key = `wowVoiceDesc${cap(v)}` as const;
      out[v] = t(key);
    }
    return out;
  }, [t]);

  const sliderDefs = useMemo(
    () =>
      PERSONALITY_SLIDER_META.map((m) => ({
        ...m,
        label: t(`wowSlider${cap(m.key)}Label` as const),
        min: t(`wowSlider${cap(m.key)}Min` as const),
        max: t(`wowSlider${cap(m.key)}Max` as const),
        badge: m.badge ?? t("wowComingSoon"),
      })),
    [t],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Modèle — picker dropdown réservé admin. Le tenant voit un Tag
       *  verrouillé (lock) à la place. Badge ADMIN pour signaler que
       *  ce contrôle n'apparaît PAS sur /dashboard du tenant. */}
      {isAdmin ? (
        <div>
          <div className="mb-1.5 flex items-baseline gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
              {t("modelLabel")}
            </p>
            <AdminBadge size="xs" />
          </div>
          <select
            value={form.model}
            onChange={(e) => update("model", e.target.value)}
            className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors focus:border-[#0e7490] focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15"
          >
            {catalogModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} · {m.provider}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-[#0e7490]">{t("modelHint")}</p>
        </div>
      ) : (
        <Tag label={t("modelLabel")} value={form.model} lock />
      )}

      {/* Voice picker avec gender */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
          {t("voiceLabel")}
        </p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {availableVoices.map((v) => {
            const active = v === form.voice;
            const gender = VOICE_GENDER[v] ?? "m";
            const isF = gender === "f";
            const desc = voiceDescMap[v] ?? "";
            const activeGradient = isF
              ? "from-[#be185d] to-[#ec4899]"
              : "from-[#06b6d4] to-[#0e7490]";
            const inactiveHover = isF
              ? "hover:border-[#be185d]/40"
              : "hover:border-[#0e7490]/40";
            const inactivePlay = isF
              ? "bg-[#fdf2f8] text-[#be185d]"
              : "bg-[#ecfeff] text-[#0e7490]";
            const inactiveBadge = isF
              ? "text-[#be185d] bg-[#fdf2f8] ring-[#fbcfe8]"
              : "text-[#0e7490] bg-[#ecfeff] ring-[#22d3ee]/40";
            return (
              <button
                key={v}
                type="button"
                onClick={() => update("voice", v)}
                className={`group flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-all duration-300 ${
                  active
                    ? `border-transparent bg-gradient-to-br ${activeGradient} text-white shadow-md`
                    : `border-[#e2e8f0] bg-white/60 text-[#18181b] hover:-translate-y-0.5 hover:bg-white hover:shadow-md ${inactiveHover}`
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold">{v}</p>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 ring-inset transition-colors ${
                        active
                          ? "bg-white/20 text-white ring-white/30"
                          : inactiveBadge
                      }`}
                    >
                      {isF ? "F" : "M"}
                    </span>
                  </div>
                  <p
                    className={`mt-0.5 truncate text-[11px] ${active ? "text-white/75" : "text-[#475569]"}`}
                  >
                    {isF ? t("wowGenderF") : t("wowGenderM")}
                    {desc ? ` · ${desc}` : ""}
                  </p>
                </div>
                <span
                  aria-hidden
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
                    active
                      ? "scale-110 bg-white/20 text-white"
                      : `${inactivePlay} group-hover:scale-110`
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 h-3 w-3">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-4 text-[11px] text-[#475569]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-gradient-to-br from-[#be185d] to-[#ec4899]" />
            {t("wowGenderF")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-gradient-to-br from-[#06b6d4] to-[#0e7490]" />
            {t("wowGenderM")}
          </span>
        </div>
      </div>

      {/* Réduction de bruit — Quail Voice Focus 2.1 L (ai-coustics), 1-10 */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-gradient-to-br from-[#fdf2f8]/40 to-white/60 p-5 sm:p-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#be185d]">
            {t("wowNoiseTitle")}
          </p>
          <span className="rounded-full bg-[#be185d]/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#be185d]">
            Quail VF 2.1 L
          </span>
        </div>
        <p className="mb-4 text-[12px] leading-relaxed text-[#475569]">
          {t("wowNoiseSubtitle")}
        </p>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-[11px] text-[#475569]">
            <span>{t("wowNoiseMin")}</span>
            <span className="font-mono text-sm font-semibold tabular-nums text-[#be185d]">
              {form.noiseReductionLevel}
              <span className="text-[10px] font-normal text-[#94a3b8]"> / 10</span>
            </span>
            <span>{t("wowNoiseMax")}</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={form.noiseReductionLevel}
            onChange={(e) =>
              update("noiseReductionLevel", Number(e.target.value))
            }
            aria-label={t("wowNoiseTitle")}
            className="w-full accent-[#be185d]"
            style={{
              background: `linear-gradient(to right, #be185d 0%, #ec4899 ${
                ((form.noiseReductionLevel - 1) / 9) * 100
              }%, #e2e8f0 ${
                ((form.noiseReductionLevel - 1) / 9) * 100
              }%, #e2e8f0 100%)`,
              height: 6,
              borderRadius: 9999,
              appearance: "none",
              outline: "none",
            }}
          />
        </div>
      </div>

      {/* Personnalité — 9 sliders, 3 enabled (vitesse/créativité/réactivité) */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-gradient-to-br from-[#ecfeff]/40 to-white/60 p-5 sm:p-6">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
            {t("wowPersonalityTitle")}
          </p>
          <button
            type="button"
            onClick={resetPersonality}
            className="text-[10px] font-medium text-[#475569] underline-offset-4 hover:underline"
          >
            {t("wowReset")}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-x-6 gap-y-5 lg:grid-cols-2">
          {sliderDefs.map((s) => (
            <PersonalitySlider
              key={s.key}
              label={s.label}
              value={getPersonalityValue(s.key)}
              onChange={(v) => setPersonalityValue(s.key, v)}
              minLabel={s.min}
              maxLabel={s.max}
              icon={s.icon}
              animClass={s.anim}
              enabled={s.enabled}
              badge={s.badge}
              midLabel={t("wowSliderMid")}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PersonaPanel({
  form,
  update,
  primaryLanguages,
  adminInheritablePreview,
  planLabel,
  t,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  primaryLanguages: ReadonlyArray<{ value: string; flag: string; label: string }>;
  adminInheritablePreview: string;
  planLabel: string;
  t: ReturnType<typeof useTranslations<"DashboardConfig">>;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Inherit mode */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-gradient-to-br from-[#ecfeff]/50 to-white/30 p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
          {planLabel
            ? t("wowModeTitleWithPlan", { plan: planLabel })
            : t("wowModeTitle")}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <RadioCard
            active={form.inheritAdminGlobals}
            onClick={() => update("inheritAdminGlobals", true)}
            title={t("inheritAdminLabel")}
            desc={t("inheritAdminHelp")}
          />
          <RadioCard
            active={!form.inheritAdminGlobals}
            onClick={() => update("inheritAdminGlobals", false)}
            title={t("wowModeCustom")}
            desc={t("wowModeCustomDesc")}
          />
        </div>
        {form.inheritAdminGlobals && adminInheritablePreview && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[10px] text-[#0e7490] hover:underline">
              {t("wowViewInherited")}
            </summary>
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white/70 p-3 font-mono text-[10px] leading-relaxed text-[#18181b]">
              {adminInheritablePreview}
            </pre>
          </details>
        )}
      </div>

      {/* Langue */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
          {t("primaryLanguageLabel")}
        </p>
        <div className="flex flex-wrap gap-2">
          {primaryLanguages.map((l) => {
            const active = l.value === form.primaryLanguage;
            return (
              <button
                key={l.value}
                type="button"
                onClick={() => update("primaryLanguage", l.value)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-300 ${
                  active
                    ? "border-transparent bg-[#18181b] text-white shadow-md"
                    : "border-[#e2e8f0] bg-white/60 text-[#18181b] hover:-translate-y-0.5 hover:border-[#0e7490]/40 hover:shadow-sm"
                }`}
              >
                <span className="font-mono text-[10px] opacity-70">{l.flag}</span>
                {l.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-[#475569]">
          {t("primaryLanguageHint")}
        </p>
      </div>

      {/* Agent name (facultatif) — prononcé dans la phrase d'accueil */}
      <div>
        <div className="mb-2 flex items-baseline gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
            {t("wowAgentNameLabel")}
          </p>
          <span className="text-[10px] text-[#94a3b8]">
            {t("wowOptional")}
          </span>
        </div>
        <input
          type="text"
          value={form.agentName}
          onChange={(e) => update("agentName", e.target.value)}
          placeholder={t("wowAgentNamePlaceholder")}
          maxLength={80}
          className="w-full rounded-2xl border border-[#e2e8f0] bg-white/80 px-4 py-2.5 text-sm text-[#18181b] shadow-inner backdrop-blur transition-all focus:border-[#0e7490] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15"
        />
        <p className="mt-1.5 text-[11px] text-[#475569]">
          {t("wowAgentNameHint")}
        </p>
      </div>

      {/* Greeting */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
          {t("greetingLabel")}
        </p>
        <input
          type="text"
          value={form.greetingInstructions}
          onChange={(e) => update("greetingInstructions", e.target.value)}
          placeholder={t("greetingPlaceholder")}
          className="w-full rounded-2xl border border-[#e2e8f0] bg-white/80 px-4 py-2.5 text-sm text-[#18181b] shadow-inner backdrop-blur transition-all focus:border-[#0e7490] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15"
        />
        <p className="mt-1.5 text-[11px] text-[#475569]">{t("greetingHint")}</p>
      </div>

      {/* Tools disponibles — built-in + knowledge */}
      <ToolsAvailableHint form={form} update={update} />

      {/* Instructions (persona) — facultatif + contenu collapsable */}
      <div>
        <div className="mb-1.5 flex items-baseline gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
            {t("instructionsLabel")}
          </p>
          <span className="text-[10px] text-[#94a3b8]">{t("wowOptional")}</span>
        </div>
        <p className="mb-2 text-[11px] leading-relaxed text-[#475569]">
          {t("instructionsDescription")}
        </p>
        <details className="group rounded-2xl border border-[#e2e8f0] bg-white/40">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 py-2.5 text-[12px] font-medium text-[#0e7490] transition-colors hover:bg-[#ecfeff]/50">
            <span>{t("instructionsToggle")}</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4 shrink-0 transition-transform duration-200 group-open:rotate-180"
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="px-3 pb-3">
            <textarea
              value={form.instructions}
              onChange={(e) => update("instructions", e.target.value)}
              rows={24}
              className="w-full rounded-2xl border border-[#e2e8f0] bg-white/80 px-4 py-3 font-mono text-xs leading-relaxed text-[#18181b] shadow-inner backdrop-blur transition-all focus:border-[#0e7490] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15"
            />
            <p className="mt-1.5 text-[11px] text-[#475569]">
              {t("instructionsHint")}
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}

function NotifsPanel({
  form,
  update,
  t,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  t: ReturnType<typeof useTranslations<"DashboardConfig">>;
}) {
  // Local-only state for SMS/Email (pas encore en DB)
  const [smsOn, setSmsOn] = useState(false);
  const [smsValue, setSmsValue] = useState("");
  const [emailOn, setEmailOn] = useState(false);
  const [emailValue, setEmailValue] = useState("");

  return (
    <div className="flex flex-col gap-3">
      <NotifChannelCard
        label="WhatsApp"
        color="#25D366"
        icon={
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.83 9.83 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.81 11.81 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.88 11.88 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.82 11.82 0 0 0-3.48-8.413Z" />
          </svg>
        }
        on={Boolean(form.ownerWhatsapp)}
        onToggle={(v) => {
          if (!v) update("ownerWhatsapp", "");
        }}
        value={form.ownerWhatsapp}
        onChangeValue={(v) => update("ownerWhatsapp", v)}
        placeholder="+972..."
        inputType="tel"
        hint={t("ownerWhatsappHint")}
        testEndpoint="/api/dashboard/notifications/whatsapp-test"
      />
      <NotifChannelCard
        label="Email"
        color="#0e7490"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 6-10 7L2 6" />
          </svg>
        }
        on={emailOn}
        onToggle={setEmailOn}
        value={emailValue}
        onChangeValue={setEmailValue}
        placeholder="contact@..."
        inputType="email"
        testEndpoint="/api/dashboard/notifications/email-test"
      />
      <NotifChannelCard
        label="SMS"
        color="#3B82F6"
        comingSoon
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        }
        on={smsOn}
        onToggle={setSmsOn}
        value={smsValue}
        onChangeValue={setSmsValue}
        placeholder="+972..."
        inputType="tel"
      />
      <p className="rounded-xl bg-[#ecfeff]/60 px-4 py-3 text-[11px] leading-relaxed text-[#475569]">
        {t("whatsappFooter")}
      </p>
    </div>
  );
}

// ─── Business panel — identité, centres, horaires, soins & tarifs ──────

const WEEKDAY_KEY: Record<WeekDay, { short: string; long: string }> = {
  sun: { short: "businessDaySunShort", long: "businessDaySunLong" },
  mon: { short: "businessDayMonShort", long: "businessDayMonLong" },
  tue: { short: "businessDayTueShort", long: "businessDayTueLong" },
  wed: { short: "businessDayWedShort", long: "businessDayWedLong" },
  thu: { short: "businessDayThuShort", long: "businessDayThuLong" },
  fri: { short: "businessDayFriShort", long: "businessDayFriLong" },
  sat: { short: "businessDaySatShort", long: "businessDaySatLong" },
};

const weekdayLabel = (
  t: ReturnType<typeof useTranslations<"DashboardConfig">>,
  d: WeekDay,
) => ({
  short: t(WEEKDAY_KEY[d].short as Parameters<typeof t>[0]),
  long: t(WEEKDAY_KEY[d].long as Parameters<typeof t>[0]),
});

const newId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isHoursValid = (h: DayHours) => !h.open || h.openTime < h.closeTime;

const formatPriceILS = (n: number) =>
  Number.isFinite(n) ? `${Math.round(n)} ₪` : "—";
const formatDuration = (min: number) => {
  if (!Number.isFinite(min) || min <= 0) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${m.toString().padStart(2, "0")}`;
};

function BusinessPanel({
  form,
  update,
  t,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  t: ReturnType<typeof useTranslations<"DashboardConfig">>;
}) {
  const business = form.business;
  const patch = (partial: Partial<BusinessConfig>) =>
    update("business", { ...business, ...partial });

  const [scanOpen, setScanOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      {/* Auto-remplissage depuis le site web du tenant (plusieurs sous-agents). */}
      <button
        type="button"
        onClick={() => setScanOpen(true)}
        className="group flex items-center justify-between gap-3 rounded-2xl border border-dashed border-[#c4b5fd] bg-gradient-to-br from-[#faf5ff] to-[#f5f3ff] px-4 py-3.5 text-left transition hover:border-[#a78bfa] hover:shadow-sm"
      >
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#6366f1] to-[#7c3aed] text-white shadow-sm">
            ✨
          </span>
          <span>
            <span className="block text-sm font-extrabold tracking-tight text-[#4c1d95]">
              {t("scanWebsiteTitle")}
            </span>
            <span className="block text-[12px] text-[#7c3aed]/80">
              {t("scanWebsiteSubtitle")}
            </span>
          </span>
        </span>
        <span className="shrink-0 rounded-lg bg-white/70 px-3 py-1.5 text-[12px] font-bold text-[#7c3aed] transition group-hover:bg-white">
          {t("scanWebsiteCta")}
        </span>
      </button>

      <WebsiteScanWizard
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        existingBusiness={business}
        onApply={(nextBusiness, primaryLanguage) => {
          update("business", nextBusiness);
          if (primaryLanguage) update("primaryLanguage", primaryLanguage);
        }}
      />

      <IdentitySection
        identity={business.identity}
        ownerWhatsapp={form.ownerWhatsapp}
        primaryLanguage={form.primaryLanguage}
        onChange={(identity) => patch({ identity })}
        t={t}
      />
      <CentresSection
        centres={business.centres}
        onChange={(centres) => patch({ centres })}
        t={t}
      />
      <CentresRulesSection
        value={business.centresRules ?? ""}
        onChange={(centresRules) => patch({ centresRules })}
        t={t}
      />
      <ServicesSection
        services={business.services}
        centres={business.centres}
        onChange={(services) => patch({ services })}
        t={t}
      />
    </div>
  );
}

// ─── ChannelsPanel ─────────────────────────────────────────────────────────
//
// Tuile "Canaux" : liste les numéros du tenant (PSTN vs WhatsApp) avec un
// badge par canal et propose un parcours d'activation WhatsApp (POC stub —
// ouvre la doc Twilio WhatsApp Sender, pas de provisioning réel). Scopé via
// asUserId pour la vue admin sur un tenant.

const TWILIO_WHATSAPP_DOCS_URL =
  "https://www.twilio.com/docs/whatsapp/self-sign-up";

function ChannelsPanel({
  t,
  asUserId,
}: {
  t: ReturnType<typeof useTranslations<"DashboardConfig">>;
  asUserId?: string;
}) {
  const [numbers, setNumbers] = useState<ChannelNumber[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const url = asUserId
      ? `/api/dashboard/channels?asUserId=${encodeURIComponent(asUserId)}`
      : "/api/dashboard/channels";
    fetch(url)
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error("fetch failed")),
      )
      .then((data: { numbers?: ChannelNumber[] }) => {
        if (!cancelled) setNumbers(data.numbers ?? []);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [asUserId]);

  const hasWhatsapp = (numbers ?? []).some((n) => n.channel === "whatsapp");

  const openTwilioDocs = () => {
    window.open(TWILIO_WHATSAPP_DOCS_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ── Liste des numéros ─────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
        <header className="border-b border-[#e2e8f0]/70 bg-white/60 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#25D366] to-[#128C7E] text-white shadow-sm">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
                aria-hidden
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <div>
              <h4 className="text-sm font-extrabold tracking-tight text-[#18181b]">
                {t("channelsNumbersTitle")}
              </h4>
              <p className="text-[11px] text-[#64748b]">
                {t("channelsNumbersSubtitle")}
              </p>
            </div>
          </div>
        </header>

        <div className="px-5 py-5">
          {numbers === null && !loadError ? (
            <p className="py-6 text-center text-sm text-[#64748b]">
              {t("channelsLoading")}
            </p>
          ) : (numbers ?? []).length === 0 ? (
            <EmptyState
              icon={
                <>
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                </>
              }
              title={t("channelsEmptyTitle")}
              body={t("channelsEmptyBody")}
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {(numbers ?? []).map((n) => (
                <li
                  key={n.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e2e8f0] bg-[#f8fafc]/60 px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <ChannelBadge channel={n.channel} t={t} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#18181b]">
                        {n.label || t("channelsNoLabel")}
                      </p>
                      <p
                        dir="ltr"
                        className="truncate font-mono text-[13px] text-[#475569] ltr:text-left rtl:text-right"
                      >
                        {n.phoneNumber}
                      </p>
                    </div>
                  </div>
                  {n.countryCode && (
                    <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#64748b] ring-1 ring-inset ring-[#e2e8f0]">
                      {n.countryCode}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── Activation WhatsApp (POC stub) ────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-[#25D366]/30 bg-gradient-to-br from-[#25D366]/8 to-white shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#25D366]/20 bg-white/60 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#25D366] to-[#128C7E] text-white shadow-sm">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-5 w-5"
                aria-hidden
              >
                <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.8 14.16c-.25.7-1.44 1.34-1.99 1.39-.51.05-1.16.07-1.87-.12-.43-.11-.99-.3-1.7-.61-2.99-1.29-4.94-4.3-5.09-4.5-.15-.2-1.22-1.62-1.22-3.09 0-1.47.77-2.19 1.04-2.49.27-.3.6-.37.8-.37.2 0 .4 0 .57.01.18.01.43-.07.67.51.25.6.85 2.07.92 2.22.07.15.12.32.02.52-.1.2-.15.32-.3.49-.15.17-.31.39-.45.52-.15.15-.3.31-.13.61.17.3.76 1.25 1.63 2.03 1.12 1 2.07 1.31 2.37 1.46.3.15.47.12.65-.07.18-.2.75-.87.95-1.17.2-.3.4-.25.67-.15.27.1 1.72.81 2.02.96.3.15.5.22.57.35.07.12.07.72-.18 1.42z" />
              </svg>
            </span>
            <div>
              <h4 className="text-sm font-extrabold tracking-tight text-[#18181b]">
                {t("channelsWhatsappTitle")}
              </h4>
              <p className="text-[11px] text-[#64748b]">
                {t("channelsWhatsappSubtitle")}
              </p>
            </div>
          </div>
          <StatusPill active={hasWhatsapp} t={t} />
        </header>

        <div className="flex flex-col gap-4 px-5 py-5">
          <p className="text-[13px] leading-relaxed text-[#475569]">
            {t("channelsWhatsappExplainer")}
          </p>
          <button
            type="button"
            onClick={openTwilioDocs}
            aria-label={t("channelsActivateWhatsapp")}
            className="inline-flex min-h-[44px] w-fit items-center gap-2 rounded-xl bg-gradient-to-br from-[#25D366] to-[#128C7E] px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.03] hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#128C7E] focus-visible:ring-offset-2 active:scale-95"
          >
            {t("channelsActivateWhatsapp")}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5 rtl:-scale-x-100"
              aria-hidden
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        </div>
      </section>
    </div>
  );
}

/** Badge canal — vert WhatsApp (icône bulle) ou neutre PSTN (icône combiné).
 *  Icônes inline SVG, jamais d'emoji. */
function ChannelBadge({
  channel,
  t,
}: {
  channel: "pstn" | "whatsapp";
  t: ReturnType<typeof useTranslations<"DashboardConfig">>;
}) {
  if (channel === "whatsapp") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#25D366]/12 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#128C7E] ring-1 ring-inset ring-[#25D366]/30">
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.8 14.16c-.25.7-1.44 1.34-1.99 1.39-.51.05-1.16.07-1.87-.12-.43-.11-.99-.3-1.7-.61-2.99-1.29-4.94-4.3-5.09-4.5-.15-.2-1.22-1.62-1.22-3.09 0-1.47.77-2.19 1.04-2.49.27-.3.6-.37.8-.37.2 0 .4 0 .57.01.18.01.43-.07.67.51.25.6.85 2.07.92 2.22.07.15.12.32.02.52-.1.2-.15.32-.3.49-.15.17-.31.39-.45.52-.15.15-.3.31-.13.61.17.3.76 1.25 1.63 2.03 1.12 1 2.07 1.31 2.37 1.46.3.15.47.12.65-.07.18-.2.75-.87.95-1.17.2-.3.4-.25.67-.15.27.1 1.72.81 2.02.96.3.15.5.22.57.35.07.12.07.72-.18 1.42z" />
        </svg>
        {t("channelsBadgeWhatsapp")}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#0e7490]/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#0e7490] ring-1 ring-inset ring-[#0e7490]/25">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
        aria-hidden
      >
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
      {t("channelsBadgePstn")}
    </span>
  );
}

/** Pastille de statut WhatsApp — vert "Active" si au moins un numéro WhatsApp
 *  est rattaché, ambre "Pending verification" sinon (POC). */
function StatusPill({
  active,
  t,
}: {
  active: boolean;
  t: ReturnType<typeof useTranslations<"DashboardConfig">>;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ring-1 ring-inset ${
        active
          ? "bg-[#25D366]/12 text-[#128C7E] ring-[#25D366]/30"
          : "bg-[#f59e0b]/12 text-[#b45309] ring-[#f59e0b]/30"
      }`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${
          active ? "bg-[#25D366]" : "bg-[#f59e0b] motion-safe:animate-pulse"
        }`}
      />
      {active ? t("channelsStatusActive") : t("channelsStatusPending")}
    </span>
  );
}

// ─── CentresRules ────────────────────────────────────────────────────────

const CENTRES_RULES_MAX = 4000;

const CENTRES_RULES_EXAMPLE = `### Ouverture par jour
- Lundi → **uniquement Ashdod** (Jérusalem et Natanya fermés ce jour-là)
- Mercredi → **uniquement Natanya** (les autres centres sont fermés)
- Autres jours (mardi, jeudi, vendredi, samedi, dimanche) → **uniquement Jérusalem**

### Centre par défaut
Si la cliente ne précise pas le centre, propose celui qui correspond au jour qu'elle demande — NE PAS proposer un autre centre pour ce jour-là.

### Vérification
Avant CHAQUE appel à check_availability, calcule mentalement le jour de la semaine de la date demandée et vérifie qu'il correspond au bon centre. Si non, propose la prochaine date du bon jour.`;

function CentresRulesSection({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (next: string) => void;
  t: ReturnType<typeof useTranslations<"DashboardConfig">>;
}) {
  const [showHelp, setShowHelp] = useState(false);
  const hasContent = value.trim().length > 0;
  const charCount = value.length;
  const overBudget = charCount > CENTRES_RULES_MAX;

  const insertExample = () => {
    onChange(
      hasContent ? `${value.trimEnd()}\n\n${CENTRES_RULES_EXAMPLE}` : CENTRES_RULES_EXAMPLE,
    );
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-gradient-to-br from-[#fef3c7]/40 to-white shadow-sm">
      <header className="border-b border-[#e2e8f0]/70 bg-white/60 px-5 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#dc2626] to-[#b45309] text-white shadow-sm">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden
              >
                <path d="M12 9v4M12 17h.01" />
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              </svg>
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[#18181b]">
                {t("businessRulesTitle")}
              </h3>
              <p className="text-[11px] text-[#64748b]">
                {t("businessRulesSubtitlePre")}{" "}
                <code className="rounded bg-[#fef3c7]/70 px-1 font-mono text-[10px]">
                  Centers and Days Rules (STRICT)
                </code>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#e2e8f0] bg-white px-3 text-[11px] font-medium text-[#475569] transition hover:bg-[#fef3c7]/40"
          >
            {showHelp ? t("businessRulesHelpHide") : t("businessRulesHelpToggle")}
          </button>
        </div>
      </header>

      <div className="px-5 py-4">
        {showHelp && (
          <div className="mb-3 rounded-xl border border-[#fde68a] bg-[#fffbeb]/80 px-4 py-3 text-[12px] leading-relaxed text-[#92400e]">
            <p className="font-semibold">{t("businessRulesHelpUseCase")}</p>
            <p className="mt-1">{t("businessRulesHelpBody")}</p>
            <p className="mt-2">
              {t.rich("businessRulesHelpInjected", {
                strong: (chunks) => <strong>{chunks}</strong>,
                em: (chunks) => <em>{chunks}</em>,
              })}
            </p>
            <button
              type="button"
              onClick={insertExample}
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-[#dc2626] px-3.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#b91c1c]"
            >
              {t("businessRulesInsertExample")}
            </button>
          </div>
        )}

        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("businessRulesPlaceholder")}
          rows={Math.max(6, Math.min(20, value.split("\n").length + 1))}
          className={`w-full resize-y rounded-xl border bg-white px-3.5 py-2.5 font-mono text-[12px] leading-relaxed text-[#18181b] shadow-inner transition placeholder:text-[#cbd5e1] focus:outline-none focus:ring-2 ${
            overBudget
              ? "border-red-300 focus:border-red-500 focus:ring-red-500/20"
              : "border-[#e2e8f0] focus:border-[#dc2626]/60 focus:ring-[#dc2626]/20"
          }`}
          aria-describedby="centres-rules-help"
        />

        <div
          id="centres-rules-help"
          className="mt-2 flex items-center justify-between gap-3 text-[11px]"
        >
          <p className="text-[#64748b]">
            {hasContent
              ? t("businessRulesActiveNote")
              : t("businessRulesEmptyNote")}
          </p>
          <p
            className={`font-mono ${
              overBudget ? "font-semibold text-red-600" : "text-[#94a3b8]"
            }`}
          >
            {charCount.toLocaleString()} / {CENTRES_RULES_MAX.toLocaleString()}
          </p>
        </div>
      </div>
    </section>
  );
}

// ─── Identity ────────────────────────────────────────────────────────────

function IdentitySection({
  identity,
  ownerWhatsapp,
  primaryLanguage,
  onChange,
  t,
}: {
  identity: BusinessConfig["identity"];
  ownerWhatsapp: string;
  primaryLanguage: string;
  onChange: (identity: BusinessConfig["identity"]) => void;
  t: ReturnType<typeof useTranslations<"DashboardConfig">>;
}) {
  const [emailError, setEmailError] = useState(false);
  const setField = <K extends keyof BusinessConfig["identity"]>(
    key: K,
    value: BusinessConfig["identity"][K],
  ) => onChange({ ...identity, [key]: value });

  return (
    <section
      className="anim-fade-up overflow-hidden rounded-2xl border border-[#fde68a]/60 bg-gradient-to-br from-[#fff7ed] to-white shadow-sm"
      style={{ animationDelay: "60ms" }}
    >
      <header className="flex items-center gap-3 border-b border-[#fde68a]/40 px-5 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f59e0b] to-[#b45309] text-white shadow-md">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-extrabold tracking-tight text-[#18181b]">
            {t("businessIdentityTitle")}
          </h3>
          <p className="text-[11px] text-[#92400e]">
            {t("businessIdentitySubtitle")}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 px-5 py-5">
        <IdentityField
          label={t("businessIdentityNameLabel")}
          icon={
            <>
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2h-4a1 1 0 0 1-1-1v-5h-4v5a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2z" />
            </>
          }
        >
          <input
            type="text"
            value={identity.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder={t("businessIdentityNamePlaceholder")}
            className="w-full min-h-[44px] rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors placeholder:text-[#cbd5e1] focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
          />
        </IdentityField>

        <IdentityField
          label={t("businessIdentityTaglineLabel")}
          icon={
            <>
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
            </>
          }
        >
          <textarea
            value={identity.tagline}
            rows={2}
            onChange={(e) => setField("tagline", e.target.value)}
            placeholder={t("businessIdentityTaglinePlaceholder")}
            className="w-full resize-y rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors placeholder:text-[#cbd5e1] focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
          />
        </IdentityField>

        <IdentityField
          label={t("businessIdentityEmailLabel")}
          icon={
            <>
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <polyline points="22,6 12,13 2,6" />
            </>
          }
        >
          <input
            type="email"
            value={identity.email}
            onChange={(e) => {
              setField("email", e.target.value);
              if (emailError) setEmailError(false);
            }}
            onBlur={() =>
              setEmailError(
                identity.email.length > 0 && !EMAIL_RE.test(identity.email),
              )
            }
            placeholder={t("businessIdentityEmailPlaceholder")}
            className={`w-full min-h-[44px] rounded-xl border bg-white px-3.5 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors placeholder:text-[#cbd5e1] focus:outline-none focus:ring-4 ${
              emailError
                ? "border-[#dc2626] focus:border-[#dc2626] focus:ring-[#dc2626]/15"
                : "border-[#e2e8f0] focus:border-[#f59e0b] focus:ring-[#f59e0b]/15"
            }`}
            aria-invalid={emailError}
          />
          {emailError && (
            <p className="mt-1 text-[11px] font-medium text-[#dc2626]">
              {t("businessIdentityEmailInvalid")}
            </p>
          )}
        </IdentityField>

        <div className="mt-1 grid grid-cols-1 gap-2 rounded-xl border border-[#e2e8f0] bg-white/60 px-3.5 py-3 sm:grid-cols-2">
          <div className="flex items-center gap-2 text-[11px] text-[#475569]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-[#0e7490]" aria-hidden>
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.86 19.86 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            <span className="font-mono">{ownerWhatsapp || "—"}</span>
            <span className="ml-auto text-[10px] text-[#94a3b8]">
              {t("businessIdentityPhoneEditIn")} <span className="font-semibold text-[#0e7490]">{t("businessIdentityPhoneEditTarget")}</span>
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-[#475569]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-[#0e7490]" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span className="font-mono uppercase">{primaryLanguage}</span>
            <span className="ml-auto text-[10px] text-[#94a3b8]">
              {t("businessIdentityPhoneEditIn")} <span className="font-semibold text-[#0e7490]">{t("businessIdentityLangEditTarget")}</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function IdentityField({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#78350f]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-[#b45309]" aria-hidden>
          {icon}
        </svg>
        {label}
      </label>
      {children}
    </div>
  );
}

// ─── Centres ─────────────────────────────────────────────────────────────

function CentresSection({
  centres,
  onChange,
  t,
}: {
  centres: BusinessCentre[];
  onChange: (centres: BusinessCentre[]) => void;
  t: ReturnType<typeof useTranslations<"DashboardConfig">>;
}) {
  const [editingCentreId, setEditingCentreId] = useState<string | null>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const addCentre = () => {
    const id = newId("ctr");
    const next: BusinessCentre = {
      id,
      name: "",
      address: "",
      hours: structuredCloneCompat(DEFAULT_WEEKLY_HOURS),
    };
    onChange([...centres, next]);
    setEditingCentreId(id);
  };

  const patchCentre = (id: string, partial: Partial<BusinessCentre>) =>
    onChange(centres.map((c) => (c.id === id ? { ...c, ...partial } : c)));

  const removeCentre = (id: string) => {
    onChange(centres.filter((c) => c.id !== id));
    setEditingCentreId((curr) => (curr === id ? null : curr));
  };

  const editing = centres.find((c) => c.id === editingCentreId) ?? null;

  return (
    <section
      className="anim-fade-up rounded-2xl border border-[#e2e8f0] bg-white/70 shadow-sm"
      style={{ animationDelay: "120ms" }}
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-[#e2e8f0] px-5 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f59e0b] to-[#b45309] text-white shadow-md">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-extrabold tracking-tight text-[#18181b]">
            {t("businessCentresTitle")}
          </h3>
          <p className="text-[11px] text-[#475569]">
            {centres.length === 0
              ? t("businessCentresEmptyLabel")
              : t("businessCentresCountActive", { count: centres.length })}
          </p>
        </div>
        <button
          type="button"
          onClick={addCentre}
          className="group inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-gradient-to-br from-[#f59e0b] to-[#b45309] px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.03] hover:shadow-lg active:scale-95"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25 transition-transform group-hover:rotate-90">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-3 w-3">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          {t("businessCentresAdd")}
        </button>
      </header>

      <div className="px-5 py-5">
        {centres.length === 0 ? (
          <EmptyState
            icon={
              <>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </>
            }
            title={t("businessCentresEmptyLabel")}
            body={t("businessCentresEmptyBody")}
            cta={{ label: t("businessCentresEmptyCta"), onClick: addCentre }}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {centres.map((centre, i) => (
              <CentreCard
                key={centre.id}
                centre={centre}
                delay={i * 30}
                ref={(el) => {
                  triggerRefs.current[centre.id] = el;
                }}
                onEdit={() => setEditingCentreId(centre.id)}
                onDelete={() => removeCentre(centre.id)}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <CentreEditDrawer
          centre={editing}
          onPatch={(partial) => patchCentre(editing.id, partial)}
          onDelete={() => removeCentre(editing.id)}
          onClose={() => {
            const trigger = triggerRefs.current[editing.id];
            setEditingCentreId(null);
            // Restore focus to the originating card button.
            setTimeout(() => trigger?.focus(), 0);
          }}
          t={t}
        />
      )}
    </section>
  );
}

const CentreCard = forwardRef<
  HTMLButtonElement,
  {
    centre: BusinessCentre;
    delay: number;
    onEdit: () => void;
    onDelete: () => void;
    t: ReturnType<typeof useTranslations<"DashboardConfig">>;
  }
>(function CentreCardInner({ centre, delay, onEdit, onDelete, t }, ref) {
    return (
      <div
        className="anim-fade-up group flex flex-col rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#f59e0b]/40 hover:shadow-md"
        style={{ animationDelay: `${delay}ms` }}
      >
        <button
          type="button"
          ref={ref}
          onClick={onEdit}
          className="-m-1 flex flex-col items-start gap-2 rounded-xl p-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2"
        >
          <div className="flex w-full items-start justify-between gap-2">
            <p className="line-clamp-1 text-base font-extrabold tracking-tight text-[#18181b]">
              {centre.name || (
                <span className="italic text-[#94a3b8]">{t("businessCentreCardNoName")}</span>
              )}
            </p>
            <span
              aria-hidden
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#fffbeb] text-[#b45309] opacity-0 transition-opacity group-hover:opacity-100"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3 w-3">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </span>
          </div>
          <p className="line-clamp-1 text-[11px] text-[#475569]">
            {centre.address || (
              <span className="italic">{t("businessCentreCardNoAddress")}</span>
            )}
          </p>
        </button>

        <WeeklyHoursPills hours={centre.hours} t={t} />

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-semibold text-[#0e7490] transition-colors hover:border-[#0e7490] hover:bg-[#ecfeff]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            {t("businessCentreCardEdit")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={t("businessCentreCardDeleteAria", {
              name: centre.name || t("businessCentreCardDeleteFallback"),
            })}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-red-200 bg-red-50/50 text-red-600 transition-colors hover:bg-red-100"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
        </div>
      </div>
    );
});

function WeeklyHoursPills({
  hours,
  t,
}: {
  hours: WeeklyHours;
  t: ReturnType<typeof useTranslations<"DashboardConfig">>;
}) {
  return (
    <div
      className="mt-3 flex items-center gap-1.5"
      aria-label={t("businessHoursWeeklyAria")}
    >
      {WEEKDAY_ORDER.map((d) => {
        const day = hours[d];
        const valid = isHoursValid(day);
        const labels = weekdayLabel(t, d);
        return (
          <div
            key={d}
            title={`${labels.long} — ${
              !day.open
                ? t("businessHoursClosed")
                : valid
                  ? `${day.openTime}–${day.closeTime}`
                  : t("businessHoursInvalid")
            }`}
            className="flex flex-col items-center gap-1"
          >
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${
                !day.open
                  ? "bg-[#e2e8f0]"
                  : valid
                    ? "bg-[#10b981]"
                    : "bg-[#dc2626]"
              }`}
            />
            <span className="text-[9px] font-semibold uppercase tracking-wide text-[#94a3b8]">
              {labels.short[0]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── CentreEditDrawer ────────────────────────────────────────────────────

function CentreEditDrawer({
  centre,
  onPatch,
  onDelete,
  onClose,
  t,
}: {
  centre: BusinessCentre;
  onPatch: (partial: Partial<BusinessCentre>) => void;
  onDelete: () => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslations<"DashboardConfig">>;
}) {
  const firstInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = `centre-drawer-title-${centre.id}`;

  // Focus first input on mount.
  useEffect(() => {
    firstInputRef.current?.focus();
    firstInputRef.current?.select();
  }, []);

  // ESC closes.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const patchHours = (day: WeekDay, partial: Partial<DayHours>) => {
    onPatch({
      hours: { ...centre.hours, [day]: { ...centre.hours[day], ...partial } },
    });
  };

  const applyToOpenDays = (sourceDay: WeekDay) => {
    const src = centre.hours[sourceDay];
    if (!src.open) return;
    const next: WeeklyHours = { ...centre.hours };
    for (const d of WEEKDAY_ORDER) {
      if (d === sourceDay) continue;
      if (next[d].open) {
        next[d] = { ...next[d], openTime: src.openTime, closeTime: src.closeTime };
      }
    }
    onPatch({ hours: next });
  };

  return (
    <div
      className="overlay-anim fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="drawer-anim fixed right-0 top-0 flex h-full w-full max-w-[520px] flex-col overflow-y-auto bg-white shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#e2e8f0] bg-white/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <h3
              id={titleId}
              className="text-base font-extrabold tracking-tight text-[#18181b]"
            >
              {centre.name
                ? t("businessDrawerTitleEdit", { name: centre.name })
                : t("businessDrawerTitleNew")}
            </h3>
            <p className="text-[11px] text-[#94a3b8]">
              {t("businessDrawerSubtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("businessDrawerCloseAria")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[#475569] transition-all hover:bg-[#fee2e2] hover:text-[#dc2626] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-4 w-4">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 space-y-6 px-5 py-5">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#78350f]">
                {t("businessDrawerNameLabel")}
              </label>
              <input
                ref={firstInputRef}
                type="text"
                value={centre.name}
                onChange={(e) => onPatch({ name: e.target.value })}
                placeholder={t("businessDrawerNamePlaceholder")}
                className="w-full min-h-[44px] rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors placeholder:text-[#cbd5e1] focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#78350f]">
                {t("businessDrawerAddressLabel")}
              </label>
              <input
                type="text"
                value={centre.address}
                onChange={(e) => onPatch({ address: e.target.value })}
                placeholder={t("businessDrawerAddressPlaceholder")}
                className="w-full min-h-[44px] rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors placeholder:text-[#cbd5e1] focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
              />
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-extrabold tracking-tight text-[#18181b]">
                {t("businessDrawerHoursTitle")}
              </h4>
              <p className="text-[10px] text-[#94a3b8]">
                {t("businessDrawerHoursHint")}
              </p>
            </div>
            <WeeklyHoursGrid
              hours={centre.hours}
              onPatch={patchHours}
              onApplyToOthers={applyToOpenDays}
              t={t}
            />
          </div>
        </div>

        <footer className="sticky bottom-0 z-10 border-t border-[#e2e8f0] bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#f59e0b] to-[#b45309] px-4 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {t("businessDrawerDone")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  typeof window !== "undefined" &&
                  !window.confirm(
                    t("businessDrawerDeleteConfirm", {
                      name: centre.name || t("businessDrawerDeleteFallback"),
                    }),
                  )
                ) {
                  return;
                }
                onDelete();
                onClose();
              }}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </svg>
              {t("businessDrawerDelete")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ─── WeeklyHoursGrid ─────────────────────────────────────────────────────

function WeeklyHoursGrid({
  hours,
  onPatch,
  onApplyToOthers,
  t,
}: {
  hours: WeeklyHours;
  onPatch: (day: WeekDay, partial: Partial<DayHours>) => void;
  onApplyToOthers: (sourceDay: WeekDay) => void;
  t: ReturnType<typeof useTranslations<"DashboardConfig">>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {WEEKDAY_ORDER.map((d) => {
        const day = hours[d];
        const valid = isHoursValid(day);
        const labels = weekdayLabel(t, d);
        return (
          <div
            key={d}
            className={`flex flex-col gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
              day.open
                ? "border-[#e2e8f0] bg-white"
                : "border-[#f1f5f9] bg-[#f8fafc]"
            } ${!valid ? "border-[#dc2626] bg-[#fef2f2]" : ""}`}
          >
            <div className="flex items-center gap-2.5">
              <span className="w-9 shrink-0 text-[11px] font-bold uppercase tracking-wider text-[#475569]">
                {labels.short}
              </span>

              <button
                type="button"
                role="switch"
                aria-checked={day.open}
                aria-label={`${labels.long} ${day.open ? t("businessHoursOpen") : t("businessHoursClosed")}`}
                onClick={() => onPatch(d, { open: !day.open })}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f59e0b] focus-visible:ring-offset-2 ${
                  day.open
                    ? "bg-gradient-to-r from-[#10b981] to-[#059669] shadow-[0_0_12px_-2px_rgba(16,185,129,0.5)]"
                    : "bg-[#cbd5e1] hover:bg-[#94a3b8]"
                }`}
              >
                <span
                  aria-hidden
                  className="block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{
                    transform: day.open ? "translateX(20px)" : "translateX(0)",
                  }}
                />
              </button>

              <input
                type="time"
                value={day.openTime}
                onChange={(e) => onPatch(d, { openTime: e.target.value })}
                disabled={!day.open}
                aria-label={t("businessHoursOpenTimeAria", { day: labels.long })}
                className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-[#e2e8f0] bg-white px-2 py-1.5 text-xs font-mono text-[#18181b] shadow-xs transition-colors focus:border-[#f59e0b] focus:outline-none focus:ring-2 focus:ring-[#f59e0b]/30 disabled:cursor-not-allowed disabled:bg-[#f1f5f9] disabled:opacity-50"
              />
              <span className="text-[11px] text-[#94a3b8]">→</span>
              <input
                type="time"
                value={day.closeTime}
                onChange={(e) => onPatch(d, { closeTime: e.target.value })}
                disabled={!day.open}
                aria-label={t("businessHoursCloseTimeAria", { day: labels.long })}
                className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-[#e2e8f0] bg-white px-2 py-1.5 text-xs font-mono text-[#18181b] shadow-xs transition-colors focus:border-[#f59e0b] focus:outline-none focus:ring-2 focus:ring-[#f59e0b]/30 disabled:cursor-not-allowed disabled:bg-[#f1f5f9] disabled:opacity-50"
              />

              <button
                type="button"
                onClick={() => onApplyToOthers(d)}
                disabled={!day.open}
                title={t("businessHoursApplyToOthersTitle")}
                aria-label={t("businessHoursApplyToOthersAria", { day: labels.long })}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#e2e8f0] bg-white text-[#0e7490] transition-colors hover:border-[#0e7490] hover:bg-[#ecfeff] disabled:cursor-not-allowed disabled:opacity-30"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </div>
            {!valid && (
              <p className="pl-11 text-[10px] font-medium text-[#dc2626]">
                {t("businessHoursInconsistent")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Services ────────────────────────────────────────────────────────────

function ServicesSection({
  services,
  centres,
  onChange,
  t,
}: {
  services: BusinessService[];
  centres: BusinessCentre[];
  onChange: (services: BusinessService[]) => void;
  t: ReturnType<typeof useTranslations<"DashboardConfig">>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCentre, setFilterCentre] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q)) return false;
      if (filterCentre !== "all") {
        if (s.centreIds === "all") return true;
        if (!s.centreIds.includes(filterCentre)) return false;
      }
      return true;
    });
  }, [services, search, filterCentre]);

  const centreNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of centres) m[c.id] = c.name || t("businessServicesCentreNoName");
    return m;
  }, [centres, t]);

  const addService = () => {
    const id = newId("svc");
    const next: BusinessService = {
      id,
      name: "",
      durationMinutes: 60,
      priceILS: 200,
      centreIds: "all",
      description: "",
    };
    onChange([...services, next]);
    setEditingId(id);
  };

  const patchService = (id: string, partial: Partial<BusinessService>) =>
    onChange(services.map((s) => (s.id === id ? { ...s, ...partial } : s)));

  const removeService = (id: string) => {
    onChange(services.filter((s) => s.id !== id));
    setEditingId((curr) => (curr === id ? null : curr));
  };

  const duplicateService = (id: string) => {
    const src = services.find((s) => s.id === id);
    if (!src) return;
    const copy: BusinessService = {
      ...src,
      id: newId("svc"),
      name: `${src.name} ${t("businessActionDuplicateSuffix")}`.trim(),
    };
    const idx = services.findIndex((s) => s.id === id);
    const next = [...services];
    next.splice(idx + 1, 0, copy);
    onChange(next);
  };

  const editing = services.find((s) => s.id === editingId) ?? null;

  return (
    <section
      className="anim-fade-up rounded-2xl border border-[#e2e8f0] bg-white/70 shadow-sm"
      style={{ animationDelay: "180ms" }}
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-[#e2e8f0] px-5 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f59e0b] to-[#b45309] text-white shadow-md">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
            <path d="M12 3l1.9 5.8L20 10l-5 4.8 1.5 6.2L12 17.8 7.5 21 9 14.8 4 10l6.1-1.2z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-extrabold tracking-tight text-[#18181b]">
            {t("businessServicesTitle")}
          </h3>
          <p className="text-[11px] text-[#475569]">
            {services.length === 0
              ? t("businessServicesEmptyLabel")
              : t("businessServicesCountActive", { count: services.length })}
          </p>
        </div>
        <button
          type="button"
          onClick={addService}
          className="group inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-gradient-to-br from-[#f59e0b] to-[#b45309] px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.03] hover:shadow-lg active:scale-95"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25 transition-transform group-hover:rotate-90">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-3 w-3">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          {t("businessServicesAdd")}
        </button>
      </header>

      {services.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[#e2e8f0] px-5 py-3">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("businessServicesSearchPlaceholder")}
              aria-label={t("businessServicesSearchAria")}
              className="w-full min-h-[40px] rounded-xl border border-[#e2e8f0] bg-white pl-9 pr-3 py-2 text-sm text-[#18181b] shadow-xs transition-colors placeholder:text-[#cbd5e1] focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
            />
          </div>
          <select
            value={filterCentre}
            onChange={(e) => setFilterCentre(e.target.value)}
            aria-label={t("businessServicesFilterAria")}
            className="min-h-[40px] rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-[#18181b] shadow-xs transition-colors focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
          >
            <option value="all">{t("businessServicesFilterAll")}</option>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || t("businessServicesCentreNoName")}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="px-5 py-5">
        {services.length === 0 ? (
          <EmptyState
            icon={
              <>
                <path d="M12 3l1.9 5.8L20 10l-5 4.8 1.5 6.2L12 17.8 7.5 21 9 14.8 4 10l6.1-1.2z" />
              </>
            }
            title={t("businessServicesEmptyLabel")}
            body={t("businessServicesEmptyBody")}
            cta={{ label: t("businessServicesEmptyCta"), onClick: addService }}
          />
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-base font-semibold text-[#475569]">
              {t("businessServicesNoMatchTitle")}
            </p>
            <p className="mt-1 text-[12px] text-[#94a3b8]">
              {t("businessServicesNoMatchHint")}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-hidden rounded-2xl border border-[#e2e8f0] sm:block">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-[#fffbeb] text-left text-[10px] font-bold uppercase tracking-wider text-[#92400e]">
                  <tr>
                    <th className="px-4 py-3">{t("businessServicesColName")}</th>
                    <th className="px-4 py-3">{t("businessServicesColDuration")}</th>
                    <th className="px-4 py-3">{t("businessServicesColPrice")}</th>
                    <th className="px-4 py-3">{t("businessServicesColCentres")}</th>
                    <th className="px-4 py-3 text-right">{t("businessServicesColActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s, i) => (
                    <tr
                      key={s.id}
                      className="anim-fade-up border-t border-[#f1f5f9] bg-white transition-colors hover:bg-[#fff7ed]/50"
                      style={{ animationDelay: `${i * 30}ms` }}
                    >
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setEditingId(s.id)}
                          className="block max-w-full text-left text-sm font-semibold text-[#18181b] hover:text-[#b45309] focus:outline-none focus-visible:underline"
                        >
                          {s.name || (
                            <span className="italic text-[#94a3b8]">{t("businessServicesNoName")}</span>
                          )}
                        </button>
                        {s.description && (
                          <p className="mt-0.5 line-clamp-1 text-[11px] text-[#94a3b8]">
                            {s.description}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-[#475569]">
                        {formatDuration(s.durationMinutes)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] font-semibold text-[#b45309]">
                        {formatPriceILS(s.priceILS)}
                      </td>
                      <td className="px-4 py-3">
                        <CentreBadges
                          centreIds={s.centreIds}
                          centreNameById={centreNameById}
                          t={t}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <ServiceRowAction
                            label={t("businessActionEdit")}
                            onClick={() => setEditingId(s.id)}
                            icon={
                              <>
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </>
                            }
                          />
                          <ServiceRowAction
                            label={t("businessActionDuplicate")}
                            onClick={() => duplicateService(s.id)}
                            icon={
                              <>
                                <rect x="9" y="9" width="13" height="13" rx="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </>
                            }
                          />
                          <ServiceRowAction
                            label={t("businessActionDelete")}
                            danger
                            onClick={() => removeService(s.id)}
                            icon={
                              <>
                                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              </>
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="flex flex-col gap-3 sm:hidden">
              {filtered.map((s, i) => (
                <div
                  key={s.id}
                  className="anim-fade-up rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-sm"
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  <button
                    type="button"
                    onClick={() => setEditingId(s.id)}
                    className="block w-full text-left"
                  >
                    <p className="text-sm font-semibold text-[#18181b]">
                      {s.name || (
                        <span className="italic text-[#94a3b8]">{t("businessServicesNoName")}</span>
                      )}
                    </p>
                    {s.description && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-[#94a3b8]">
                        {s.description}
                      </p>
                    )}
                  </button>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfeff] px-2 py-0.5 font-mono font-semibold text-[#0e7490]">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      {formatDuration(s.durationMinutes)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#fffbeb] px-2 py-0.5 font-mono font-semibold text-[#b45309]">
                      {formatPriceILS(s.priceILS)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <CentreBadges
                      centreIds={s.centreIds}
                      centreNameById={centreNameById}
                      t={t}
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <ServiceRowAction
                      label={t("businessActionEdit")}
                      block
                      onClick={() => setEditingId(s.id)}
                      icon={
                        <>
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </>
                      }
                    />
                    <ServiceRowAction
                      label={t("businessActionDuplicate")}
                      onClick={() => duplicateService(s.id)}
                      icon={
                        <>
                          <rect x="9" y="9" width="13" height="13" rx="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </>
                      }
                    />
                    <ServiceRowAction
                      label={t("businessActionDelete")}
                      danger
                      onClick={() => removeService(s.id)}
                      icon={
                        <>
                          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </>
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {editing && (
        <ServiceEditModal
          service={editing}
          centres={centres}
          onPatch={(partial) => patchService(editing.id, partial)}
          onDelete={() => removeService(editing.id)}
          onClose={() => setEditingId(null)}
          t={t}
        />
      )}
    </section>
  );
}

function CentreBadges({
  centreIds,
  centreNameById,
  t,
}: {
  centreIds: BusinessService["centreIds"];
  centreNameById: Record<string, string>;
  t: ReturnType<typeof useTranslations<"DashboardConfig">>;
}) {
  if (centreIds === "all") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-br from-[#10b981]/15 to-[#059669]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#047857] ring-1 ring-inset ring-[#10b981]/30">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-2.5 w-2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        {t("businessCentreBadgesAll")}
      </span>
    );
  }
  if (centreIds.length === 0) {
    return (
      <span className="text-[10px] italic text-[#94a3b8]">{t("businessCentreBadgesNone")}</span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {centreIds.slice(0, 3).map((id) => (
        <span
          key={id}
          className="inline-flex items-center rounded-full bg-[#fffbeb] px-2 py-0.5 text-[10px] font-semibold text-[#92400e] ring-1 ring-inset ring-[#fde68a]"
        >
          {centreNameById[id] ?? t("businessCentreBadgesUnknown")}
        </span>
      ))}
      {centreIds.length > 3 && (
        <span className="inline-flex items-center rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[10px] font-semibold text-[#475569]">
          +{centreIds.length - 3}
        </span>
      )}
    </div>
  );
}

function ServiceRowAction({
  label,
  onClick,
  icon,
  danger = false,
  block = false,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  danger?: boolean;
  block?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex h-9 ${block ? "flex-1 px-3 text-xs font-semibold" : "w-9 justify-center"} items-center gap-1.5 rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
        danger
          ? "border-red-200 bg-white text-red-600 hover:bg-red-50 focus-visible:ring-red-400"
          : "border-[#e2e8f0] bg-white text-[#475569] hover:border-[#0e7490] hover:bg-[#ecfeff] hover:text-[#0e7490] focus-visible:ring-[#0e7490]"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
        {icon}
      </svg>
      {block && <span>{label}</span>}
    </button>
  );
}

// ─── ServiceEditModal ────────────────────────────────────────────────────

function ServiceEditModal({
  service,
  centres,
  onPatch,
  onDelete,
  onClose,
  t,
}: {
  service: BusinessService;
  centres: BusinessCentre[];
  onPatch: (partial: Partial<BusinessService>) => void;
  onDelete: () => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslations<"DashboardConfig">>;
}) {
  const firstInputRef = useRef<HTMLInputElement>(null);
  const titleId = `service-modal-title-${service.id}`;

  useEffect(() => {
    firstInputRef.current?.focus();
    firstInputRef.current?.select();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const isAll = service.centreIds === "all";
  const selectedIds = isAll ? [] : (service.centreIds as string[]);

  const toggleCentre = (id: string) => {
    if (isAll) {
      // Coming from "all" → start with just this one selected
      onPatch({ centreIds: [id] });
      return;
    }
    const next = selectedIds.includes(id)
      ? selectedIds.filter((c) => c !== id)
      : [...selectedIds, id];
    onPatch({ centreIds: next });
  };

  const toggleAll = () => {
    if (isAll) {
      onPatch({ centreIds: [] });
    } else {
      onPatch({ centreIds: "all" });
    }
  };

  const canSave = service.name.trim().length > 0;

  return (
    <div
      className="overlay-anim fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal-anim flex max-h-[92vh] w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:w-full"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[#e2e8f0] px-5 py-4">
          <div className="min-w-0">
            <h3
              id={titleId}
              className="text-base font-extrabold tracking-tight text-[#18181b]"
            >
              {service.name
                ? t("businessModalServiceTitleEdit", { name: service.name })
                : t("businessModalServiceTitleNew")}
            </h3>
            <p className="text-[11px] text-[#94a3b8]">
              {t("businessModalSubtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("businessModalCloseAria")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#475569] transition-all hover:bg-[#fee2e2] hover:text-[#dc2626] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-4 w-4">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#78350f]">
              {t("businessModalNameLabel")}
            </label>
            <input
              ref={firstInputRef}
              type="text"
              value={service.name}
              onChange={(e) => onPatch({ name: e.target.value })}
              placeholder={t("businessModalNamePlaceholder")}
              className="w-full min-h-[44px] rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors placeholder:text-[#cbd5e1] focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#78350f]">
                {t("businessModalDurationLabel")}
              </label>
              <input
                type="number"
                value={service.durationMinutes}
                step={5}
                min={5}
                max={480}
                onChange={(e) =>
                  onPatch({ durationMinutes: Number(e.target.value) })
                }
                className="w-full min-h-[44px] rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm font-mono text-[#18181b] shadow-xs transition-colors focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
              />
              <p className="mt-1 text-[10px] text-[#94a3b8]">
                {formatDuration(service.durationMinutes)}
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#78350f]">
                {t("businessModalPriceLabel")}
              </label>
              <input
                type="number"
                value={service.priceILS}
                step={10}
                min={0}
                max={100000}
                onChange={(e) =>
                  onPatch({ priceILS: Number(e.target.value) })
                }
                className="w-full min-h-[44px] rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm font-mono text-[#18181b] shadow-xs transition-colors focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
              />
              <p className="mt-1 text-[10px] text-[#94a3b8]">
                {formatPriceILS(service.priceILS)}
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#78350f]">
              {t("businessModalDescriptionLabel")}
            </label>
            <textarea
              value={service.description}
              rows={3}
              onChange={(e) => onPatch({ description: e.target.value })}
              placeholder={t("businessModalDescriptionPlaceholder")}
              className="w-full resize-y rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors placeholder:text-[#cbd5e1] focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#78350f]">
              {t("businessModalCentresLabel")}
            </label>
            <div className="space-y-1.5">
              <button
                type="button"
                role="checkbox"
                aria-checked={isAll}
                onClick={toggleAll}
                className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  isAll
                    ? "border-[#10b981] bg-gradient-to-br from-[#ecfdf5] to-white"
                    : "border-[#e2e8f0] bg-white hover:border-[#10b981]/40"
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                    isAll
                      ? "border-[#10b981] bg-[#10b981]"
                      : "border-[#cbd5e1] bg-white"
                  }`}
                >
                  {isAll && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" className="h-3 w-3 text-white">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                <span className="text-sm font-semibold text-[#18181b]">
                  {t("businessModalCentresAll")}
                </span>
                <span className="ml-auto text-[10px] text-[#94a3b8]">
                  {t("businessModalCentresSentinel")}
                </span>
              </button>

              {centres.length === 0 && (
                <p className="rounded-lg bg-[#fffbeb]/60 px-3 py-2 text-[11px] text-[#92400e]">
                  {t("businessModalCentresNoneHint")}
                </p>
              )}

              {!isAll &&
                centres.map((c) => {
                  const checked = selectedIds.includes(c.id);
                  return (
                    <button
                      type="button"
                      key={c.id}
                      role="checkbox"
                      aria-checked={checked}
                      onClick={() => toggleCentre(c.id)}
                      className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        checked
                          ? "border-[#f59e0b] bg-[#fffbeb]"
                          : "border-[#e2e8f0] bg-white hover:border-[#f59e0b]/40"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                          checked
                            ? "border-[#f59e0b] bg-[#f59e0b]"
                            : "border-[#cbd5e1] bg-white"
                        }`}
                      >
                        {checked && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" className="h-3 w-3 text-white">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[#18181b]">
                          {c.name || t("businessServicesCentreNoName")}
                        </span>
                        {c.address && (
                          <span className="block truncate text-[10px] text-[#94a3b8]">
                            {c.address}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-[#e2e8f0] bg-white px-5 py-4">
          <button
            type="button"
            onClick={() => {
              if (
                typeof window !== "undefined" &&
                !window.confirm(
                  t("businessModalDeleteConfirm", {
                    name: service.name || t("businessModalDeleteFallback"),
                  }),
                )
              )
                return;
              onDelete();
              onClose();
            }}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            {t("businessModalDelete")}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] transition-colors hover:bg-[#f8fafc]"
            >
              {t("businessModalCancel")}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={!canSave}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#f59e0b] to-[#b45309] px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {t("businessModalSave")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────

function EmptyState({
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

// ─── Utils ───────────────────────────────────────────────────────────────

function structuredCloneCompat<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}


// ─── Tools available hint — encart au-dessus de l'instructions textarea ─

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

function ToolsAvailableHint({
  form,
  update,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
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

// ─── Helpers ────────────────────────────────────────────────────────────

function PersonalitySlider({
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

function RadioCard({
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

function NotifChannelCard({
  label,
  icon,
  color,
  on,
  onToggle,
  value,
  onChangeValue,
  placeholder,
  inputType,
  hint,
  comingSoon = false,
  testEndpoint,
}: {
  label: string;
  icon: React.ReactNode;
  color: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  value: string;
  onChangeValue: (v: string) => void;
  placeholder: string;
  inputType: string;
  hint?: string;
  comingSoon?: boolean;
  /** Si fourni, POST {to: value} sur cet endpoint quand l'utilisateur
   *  clique sur Tester. Sans endpoint, le bouton reste désactivé (les
   *  canaux "coming soon" SMS/Email tombent sur cette branche). */
  testEndpoint?: string;
}) {
  const t = useTranslations("DashboardConfig");
  const [testStatus, setTestStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const handleTest = async () => {
    if (
      !on ||
      testStatus !== "idle" ||
      comingSoon ||
      !testEndpoint ||
      !value.trim()
    )
      return;
    setTestStatus("sending");
    setTestError(null);
    try {
      const res = await fetch(testEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: value }),
      });
      const data = (await res
        .json()
        .catch(() => ({}))) as { ok?: boolean; error?: string; hint?: string };
      if (!res.ok || !data.ok) {
        setTestStatus("error");
        setTestError(data.error ?? `HTTP ${res.status}`);
        setTimeout(() => {
          setTestStatus("idle");
          setTestError(null);
        }, 6000);
        return;
      }
      setTestStatus("sent");
      setTimeout(() => setTestStatus("idle"), 3500);
    } catch (e) {
      setTestStatus("error");
      setTestError((e as Error).message);
      setTimeout(() => {
        setTestStatus("idle");
        setTestError(null);
      }, 6000);
    }
  };

  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border-2 p-4 transition-all duration-300 ${
        on && !comingSoon
          ? "border-[#22d3ee]/40 bg-white shadow-[0_4px_20px_-8px_rgba(34,211,238,0.35)]"
          : comingSoon
            ? "border-[#e2e8f0] bg-white/50 opacity-70"
            : "border-[#cbd5e1] bg-white hover:border-[#22d3ee]/30 hover:shadow-[0_2px_12px_-4px_rgba(34,211,238,0.2)]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all"
            style={{
              backgroundColor: on && !comingSoon ? color : "#f1f5f9",
              color: on && !comingSoon ? "white" : "#94a3b8",
              boxShadow:
                on && !comingSoon ? `0 4px 16px -4px ${color}66` : "none",
            }}
          >
            {icon}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-[#18181b]">
                {label}
              </p>
              {comingSoon && (
                <span className="shrink-0 rounded-full bg-[#f1f5f9] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#94a3b8] ring-1 ring-inset ring-[#cbd5e1]">
                  {t("wowComingSoon")}
                </span>
              )}
            </div>
            <p className="text-[11px] text-[#475569]">
              {on && !comingSoon ? (
                <span className="inline-flex items-center gap-1 font-medium text-[#0e7490]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#22d3ee] motion-safe:animate-pulse" />
                  {t("wowChannelActive")}
                </span>
              ) : (
                t("wowChannelInactive")
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={on && !comingSoon}
          aria-label={t("wowToggleAria", { action: on ? t("wowToggleDisable") : t("wowToggleEnable"), label })}
          onClick={() => !comingSoon && onToggle(!on)}
          disabled={comingSoon}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22d3ee] focus-visible:ring-offset-2 disabled:cursor-not-allowed ${
            on && !comingSoon
              ? "bg-gradient-to-r from-[#22d3ee] to-[#0e7490] shadow-[0_0_16px_-2px_rgba(34,211,238,0.6)]"
              : comingSoon
                ? "bg-[#e2e8f0]"
                : "bg-[#94a3b8] hover:bg-[#64748b]"
          }`}
        >
          <span
            aria-hidden
            className="block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{
              transform: on && !comingSoon ? "translateX(20px)" : "translateX(0)",
            }}
          />
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChangeValue(e.target.value)}
          placeholder={placeholder}
          disabled={!on || comingSoon}
          className="min-w-0 flex-1 rounded-xl border border-[#e2e8f0] bg-white/80 px-3 py-2 font-mono text-xs text-[#18181b] transition-all focus:border-[#0e7490] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15 disabled:cursor-not-allowed disabled:opacity-40"
        />
        <button
          type="button"
          onClick={handleTest}
          disabled={
            !on ||
            testStatus !== "idle" ||
            comingSoon ||
            !testEndpoint ||
            !value.trim()
          }
          aria-label={t("wowTestAria", { label })}
          className={`group inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${
            testStatus === "sent"
              ? "border-[#22d3ee]/40 bg-[#ecfeff] text-[#0e7490]"
              : testStatus === "error"
                ? "border-[#dc2626]/40 bg-[#fee2e2] text-[#991b1b]"
                : "border-[#0e7490]/30 bg-white text-[#0e7490] hover:-translate-y-0.5 hover:border-[#0e7490] hover:bg-[#ecfeff] hover:shadow-sm"
          }`}
        >
          {testStatus === "sending" ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 motion-safe:animate-spin">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              {t("wowTestSending")}
            </>
          ) : testStatus === "sent" ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {t("wowTestSent")}
            </>
          ) : testStatus === "error" ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16h.01" />
              </svg>
              Échec
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              {t("wowTestButton")}
            </>
          )}
        </button>
      </div>

      {testError && (
        <p className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-2.5 py-1.5 text-[11px] leading-snug text-[#991b1b]">
          {testError}
        </p>
      )}
      {hint && !testError && <p className="text-[11px] text-[#475569]">{hint}</p>}
    </div>
  );
}

function Tag({
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

function Stat({
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

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/60">
        {label}
      </p>
      <p className="truncate font-mono text-sm font-medium">{value}</p>
    </div>
  );
}
