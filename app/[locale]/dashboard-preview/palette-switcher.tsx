"use client";

import { useEffect, useState } from "react";

/**
 * Switcher de palette local à la page de preview. Injecte des overrides de
 * CSS vars via `style` sur un wrapper, sans toucher `globals.css`. Persistance
 * via localStorage pour retrouver le choix entre rechargements.
 *
 * Ajouter une nouvelle variante = ajouter une entrée dans PALETTES.
 * Mapping clé = nom de la CSS var (sans le `--` initial).
 */

type PaletteVars = {
  primary?: string;
  magenta?: string;
  cyan?: string;
  accent?: string;
  coral?: string;
  teal?: string;
  "dark-bg"?: string;
  "light-bg-warm"?: string;
  background?: string;
  foreground?: string;
  border?: string;
  muted?: string;
  "muted-foreground"?: string;
  success?: string;
  warning?: string;
  "warning-strong"?: string;
  destructive?: string;
};

type Palette = {
  id: string;
  name: string;
  description: string;
  vars: PaletteVars;
};

const PALETTES: ReadonlyArray<Palette> = [
  {
    id: "brand",
    name: "Marque officielle",
    description: "Palette validée — dark hero, cyan voice tech, rose CTA",
    vars: {}, // défaut globals.css
  },
  {
    id: "warm",
    name: "Warm pastel",
    description: "Roses doux dominants, cyan en accent ponctuel, pas de slate dark",
    vars: {
      primary: "#db2777",
      magenta: "#be185d",
      accent: "#f472b6",     // accent = coral au lieu de cyan
      cyan: "#22d3ee",        // cyan reste dispo mais accent ne tape pas dessus
      coral: "#f472b6",
      "dark-bg": "#831843",   // hero passe en rose-900 (chaud) au lieu de slate
      background: "#fff5f7",  // fond plus pâle/chaud
      foreground: "#1e1b2e",
      "warning-strong": "#be185d",
    },
  },
  {
    id: "mono",
    name: "Mono rose",
    description: "Tout rose, zéro cyan. Hero magenta foncé, accents roses graduées",
    vars: {
      primary: "#db2777",
      magenta: "#9d174d",
      accent: "#ec4899",
      cyan: "#db2777",       // cyan = rose aussi (purifie l'identité)
      coral: "#f472b6",
      teal: "#9d174d",
      "dark-bg": "#500724",  // rose-950 très foncé
      background: "#fff1f2",
      foreground: "#1e2937",
      "warning-strong": "#9d174d",
    },
  },
  {
    id: "tech",
    name: "Tech minimal",
    description: "Slate dominant, blanc cassé, cyan punchy, rose ponctuel",
    vars: {
      primary: "#db2777",
      magenta: "#be185d",
      accent: "#22d3ee",
      cyan: "#06b6d4",        // cyan plus saturé (cyan-500 vs cyan-400)
      coral: "#fb7185",        // coral plus rouge-orangé
      teal: "#0e7490",
      "dark-bg": "#0f172a",   // slate-900 plus profond
      background: "#f8fafc",  // slate-50 (neutre, pas rose)
      foreground: "#0f172a",
      border: "#e2e8f0",      // slate-200 neutre
      "muted-foreground": "#64748b",
    },
  },
  {
    id: "vivid",
    name: "Vivid contrast",
    description: "Saturé partout. Magenta vif + cyan néon + dark profond",
    vars: {
      primary: "#e11d48",     // rose-600 plus rouge/saturé
      magenta: "#be185d",
      accent: "#06b6d4",
      cyan: "#06b6d4",
      coral: "#f43f5e",
      teal: "#0891b2",
      "dark-bg": "#18181b",   // zinc-900 (vrai dark)
      background: "#fef2f2",  // red-50 (rose chaud)
      foreground: "#18181b",
    },
  },
  {
    id: "soft",
    name: "Soft luxury",
    description: "Pastel premium. Roses désaturés, foncés boisés, cyan glacé",
    vars: {
      primary: "#c2497a",     // rose désaturé/poudré
      magenta: "#9a3865",
      accent: "#a8c5d6",       // cyan désaturé/glacé
      cyan: "#a8c5d6",
      coral: "#e3a7b8",
      teal: "#5b8a96",
      "dark-bg": "#3c1f2e",   // bordeaux foncé
      background: "#fdf6f7",
      foreground: "#3c1f2e",
      border: "#ead4dc",
    },
  },
  // ── Variantes "pro + féminin + choc" (post-consultation ui-ux-pro-max) ──
  {
    id: "editorial",
    name: "Magenta editorial",
    description: "Cream + magenta saturé + noir charcoal. Vibe Vogue/Pinterest premium",
    vars: {
      primary: "#be185d",      // magenta saturé brand
      magenta: "#831843",      // bordeaux plus profond
      accent: "#18181b",       // noir charbon = accent (au lieu de cyan)
      cyan: "#18181b",         // cyan aussi en noir pour purifier
      coral: "#ec4899",        // pink hot pour highlights
      teal: "#4a4a4a",         // charcoal pour tech hints
      "dark-bg": "#18181b",    // hero zinc-900 profond
      background: "#faf7f2",   // cream off-white luxe
      foreground: "#18181b",
      border: "#ead4d4",       // border tinted cream-rose
      muted: "#f5ede5",        // hover cream légèrement plus foncé
      "muted-foreground": "#6b5b4d",  // brown chic
      "warning-strong": "#831843",
    },
  },
  {
    id: "bordeaux",
    name: "Bordeaux velours",
    description: "Bordeaux profond + or rosé. Vibe hôtel particulier / maison de couture",
    vars: {
      primary: "#9d174d",      // burgundy saturé
      magenta: "#831843",      // bordeaux deep
      accent: "#c9a77f",        // or rosé (replace cyan)
      cyan: "#c9a77f",
      coral: "#e8b4c8",         // rose poudré
      teal: "#8b6f47",          // or foncé
      "dark-bg": "#2e0e1f",    // wine très profond
      background: "#faf7f2",   // cream
      foreground: "#2e0e1f",
      border: "#e6d5d8",
      muted: "#f0e6e8",
      "muted-foreground": "#6b4a52",
      "warning-strong": "#831843",
    },
  },
  {
    id: "neon-night",
    name: "Rose néon nuit",
    description: "Dark mode complet + magenta néon. Vibe Studio Berlin / club privé",
    vars: {
      primary: "#ff1493",       // deep pink fluo
      magenta: "#c71585",
      accent: "#ffb6c1",         // light pink néon
      cyan: "#ffb6c1",
      coral: "#ff69b4",          // hot pink
      teal: "#ff1493",
      "dark-bg": "#0a0a0a",     // deep black hero
      background: "#fdf2f8",    // light en background pour cards lisibles
      foreground: "#0a0a0a",
      border: "#f5d6e3",
      "warning-strong": "#c71585",
    },
  },
  // ── Variantes LIGHT bg + hero saturé color-block (pas de slate/noir) ──
  {
    id: "magenta-block",
    name: "Magenta color block",
    description: "Cream bg + hero MAGENTA plein saturé (pas dark). Vibe éditorial Vogue",
    vars: {
      primary: "#be185d",        // magenta marque
      magenta: "#831843",
      accent: "#fbbf24",          // gold/amber pour highlights subtils
      cyan: "#831843",            // pas de cyan, alignement mono
      coral: "#ec4899",
      teal: "#831843",
      "dark-bg": "#be185d",       // ⭐ HERO MAGENTA SATURÉ (pas slate)
      background: "#faf7f2",     // cream luxe
      foreground: "#18181b",
      border: "#ead4d4",
      muted: "#f5ede5",
      "muted-foreground": "#6b5b4d",
      "warning-strong": "#831843",
    },
  },
  {
    id: "coral-splash",
    name: "Coral splash",
    description: "Cream bg + hero CORAL hot pink saturé. Vibe Glossier / Rare Beauty",
    vars: {
      primary: "#ec4899",         // hot pink vif
      magenta: "#be185d",
      accent: "#9d174d",           // bordeaux pour contraste accent
      cyan: "#be185d",
      coral: "#fb7185",
      teal: "#9d174d",
      "dark-bg": "#fb7185",        // ⭐ HERO CORAL/HOT PINK
      background: "#fff5f5",      // rosé blanc-cassé
      foreground: "#4c0519",
      border: "#fce7e7",
      "warning-strong": "#9d174d",
    },
  },
  {
    id: "burgundy-block",
    name: "Burgundy color block",
    description: "Cream + hero BURGUNDY plein. Couture maison de mode, féminin maîtrisé",
    vars: {
      primary: "#9d174d",          // burgundy saturé
      magenta: "#831843",
      accent: "#c9a77f",            // or rosé pour highlights
      cyan: "#c9a77f",
      coral: "#e8b4c8",
      teal: "#9d174d",
      "dark-bg": "#831843",        // ⭐ HERO BURGUNDY plein
      background: "#faf7f2",       // cream
      foreground: "#2e0e1f",
      border: "#e6d5d8",
      muted: "#f0e6e8",
      "muted-foreground": "#6b4a52",
      "warning-strong": "#831843",
    },
  },
];

const STORAGE_KEY = "tamara-preview-palette";

export function PaletteSwitcher() {
  // Default à null pour éviter mismatch SSR/CSR — le bandeau ne rend qu'après mount.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    setSelectedId(stored && PALETTES.some((p) => p.id === stored) ? stored : "brand");
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const palette = PALETTES.find((p) => p.id === selectedId);
    if (!palette) return;
    // Apply vars to :root for global propagation (Hero use --color-dark-bg
    // hardcoded, save bar idem, etc.). On scope pas au wrapper pour que TOUS
    // les `var(--color-...)` du sous-arbre soient repris.
    const root = document.documentElement;
    // Reset des overrides précédents :
    const allKeys = new Set<string>();
    PALETTES.forEach((p) => Object.keys(p.vars).forEach((k) => allKeys.add(k)));
    allKeys.forEach((k) => root.style.removeProperty(`--color-${k}`));
    // Apply nouvelles vars :
    Object.entries(palette.vars).forEach(([k, v]) => {
      if (v) root.style.setProperty(`--color-${k}`, v);
    });
    localStorage.setItem(STORAGE_KEY, selectedId);
  }, [selectedId]);

  // Skip rendering avant mount → évite hydration mismatch (selectedId null
  // côté SSR, palette par défaut sera appliquée après mount).
  if (!selectedId) {
    return (
      <div className="mb-4 h-12 rounded-2xl border-2 border-dashed border-[var(--color-border)] bg-white/40" />
    );
  }

  return (
    <div className="mb-4 rounded-2xl border-2 border-[var(--color-border)] bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[var(--color-primary)]">
          Test palette
        </p>
        <p className="text-[11px] text-[var(--color-muted-foreground)]">
          {PALETTES.find((p) => p.id === selectedId)?.description}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PALETTES.map((p) => {
          const active = p.id === selectedId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              className={`group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 ${
                active
                  ? "border-transparent bg-[var(--color-foreground)] text-white shadow-md"
                  : "border-[var(--color-border)] bg-white text-[var(--color-foreground)] hover:border-[var(--color-primary)]/40 hover:bg-[var(--color-muted)]/40"
              }`}
            >
              {/* Mini swatch trio : primary, accent, dark-bg pour visualiser */}
              <span className="flex h-3 gap-0.5">
                <span
                  className="h-3 w-1.5 rounded-full"
                  style={{ backgroundColor: p.vars.primary ?? "var(--color-primary)" }}
                />
                <span
                  className="h-3 w-1.5 rounded-full"
                  style={{ backgroundColor: p.vars.accent ?? p.vars.cyan ?? "var(--color-accent)" }}
                />
                <span
                  className="h-3 w-1.5 rounded-full"
                  style={{ backgroundColor: p.vars["dark-bg"] ?? "var(--color-dark-bg)" }}
                />
              </span>
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
