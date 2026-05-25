"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  useRealtimeCatalog,
  voicesForCatalog,
} from "@/lib/use-realtime-catalog";

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
};

const PRIMARY_LANGUAGES = [
  { value: "fr", label: "🇫🇷 Français" },
  { value: "he", label: "🇮🇱 עברית" },
  { value: "en", label: "🇺🇸 English" },
] as const;

export type TenantConfigSection =
  | "persona"
  | "inherit"
  | "whatsapp"
  | "voice";

export function AdminTenantConfigForm({
  userId,
  initial,
  adminInheritablePreview,
  planLabel,
  section,
}: {
  userId: string;
  initial: FormState;
  initialVoices: readonly string[];
  /** Texte assemblé des blocs admin que le tenant hérite pour son plan
   *  (spoken_time + spoken_phone + hangup + per_call_context +
   *  config_blocks + admin_global). Sert juste pour le popup info — on
   *  ne le ré-envoie pas avec le save. */
  adminInheritablePreview: string;
  planLabel: string;
  /** Si fourni, n'affiche que la Card correspondante (les autres sont
   *  conservées dans le DOM via `hidden` pour préserver le state form
   *  + permettre une save bar globale partagée). Si omis : toutes
   *  les Cards visibles (compatibilité ascendante). */
  section?: TenantConfigSection;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const catalog = useRealtimeCatalog();
  const availableVoices = useMemo(
    () => voicesForCatalog(catalog, form.model),
    [catalog, form.model],
  );

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
      const res = await fetch(`/api/admin/configs/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Erreur de sauvegarde");
        return;
      }
      setSavedAt(new Date().toLocaleTimeString("fr-FR"));
      setDirty(false);
      // Refresh la page côté server pour re-build promptBlocks +
      // fullPromptConcat avec les nouvelles instructions DB. Sans ça
      // le panel Preview reste sur l'ancien prompt jusqu'au reload manuel.
      router.refresh();
    });
  };

  const showAll = section === undefined;
  const showPersona = showAll || section === "persona";
  const showInherit = showAll || section === "inherit";
  const showWhatsapp = showAll || section === "whatsapp";
  const showVoice = showAll || section === "voice";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div hidden={!showPersona}>
      <Card title="Persona" subtitle="Instructions système qui définissent l'identité, les workflows et les règles.">
        <Field
          label="Langue principale"
          hint="Langue de la phrase d'accueil. L'agent bascule auto vers la langue de la cliente après."
        >
          <select
            value={form.primaryLanguage}
            onChange={(e) => update("primaryLanguage", e.target.value)}
            className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm shadow-xs"
          >
            {PRIMARY_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Instructions">
          <textarea
            value={form.instructions}
            onChange={(e) => update("instructions", e.target.value)}
            rows={20}
            className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
          />
        </Field>

        <Field
          label="Phrase d'entrée"
          hint="Première phrase prononcée à chaque appel, avant que la cliente parle. 1-2 phrases courtes et chaleureuses."
        >
          <textarea
            value={form.greetingInstructions}
            onChange={(e) => update("greetingInstructions", e.target.value)}
            rows={3}
            placeholder="Bonjour, c'est <prénom> de <centre>. Comment puis-je vous aider ?"
            className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm leading-relaxed text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
          />
        </Field>
      </Card>
      </div>

      <div hidden={!showInherit}>
      <Card title="Héritage du prompt admin" subtitle="Décide si ce tenant utilise les directives globales définies par l'admin pour son plan.">
        <InheritToggle
          checked={form.inheritAdminGlobals}
          onChange={(v) => update("inheritAdminGlobals", v)}
          planLabel={planLabel}
          preview={adminInheritablePreview}
        />
      </Card>
      </div>

      <div hidden={!showWhatsapp}>
      <Card title="Notifications WhatsApp" subtitle="Le proprio reçoit un récap après chaque appel.">
        <Field label="Numéro WhatsApp du proprio" hint="Format E.164, ex: +972585001007. Vide = désactivé.">
          <input
            type="tel"
            placeholder="+972..."
            value={form.ownerWhatsapp}
            onChange={(e) => update("ownerWhatsapp", e.target.value)}
            className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 font-mono text-sm shadow-xs"
          />
        </Field>
      </Card>
      </div>

      <div hidden={!showVoice}>
      <Card title="Voix & modèle" subtitle="Paramètres techniques du moteur vocal.">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Modèle">
            <select
              value={form.model}
              onChange={(e) => update("model", e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm shadow-xs"
            >
              {catalog.models.map((m) => m.id).map((m) => (
                <option key={m} value={m}>
                  {m} ·{" "}
                  {catalog.models.find((r) => r.id === m)?.provider ?? "?"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Voix">
            <select
              value={form.voice}
              onChange={(e) => update("voice", e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm shadow-xs"
            >
              {availableVoices.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Slider
            label="Température"
            value={form.temperature}
            min={0}
            max={1.2}
            step={0.05}
            onChange={(v) => update("temperature", v)}
            display={form.temperature.toFixed(2)}
          />
          <Slider
            label="Vitesse"
            value={form.speed}
            min={0.5}
            max={1.5}
            step={0.05}
            onChange={(v) => update("speed", v)}
            display={form.speed.toFixed(2) + "×"}
          />
          <Field label="Max tokens / réponse" hint="Hint via prompt — ~220 ≈ 1-2 phrases">
            <input
              type="number"
              min={50}
              max={1000}
              step={10}
              value={form.maxResponseTokens}
              onChange={(e) => update("maxResponseTokens", Number(e.target.value))}
              className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm shadow-xs"
            />
          </Field>
        </div>
      </Card>
      </div>

      <div className="sticky bottom-4 z-30 mt-2">
        <div className="flex items-center justify-between gap-4 rounded-full border border-[var(--color-border)] bg-white/95 px-4 py-2 shadow-lg backdrop-blur">
          <div className="text-xs">
            {error ? (
              <span className="font-medium text-[var(--color-destructive)]">{error}</span>
            ) : dirty ? (
              <span className="text-[var(--color-warning)]">Modifications non sauvegardées</span>
            ) : savedAt ? (
              <span className="text-[var(--color-success)]">Sauvegardé à {savedAt}</span>
            ) : (
              <span className="text-[var(--color-muted-foreground)]">À jour</span>
            )}
          </div>
          <button
            type="submit"
            disabled={isPending || !dirty}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white shadow-md disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Sauvegarde…" : "Sauvegarder"}
          </button>
        </div>
      </div>
    </form>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-sm sm:p-8">
      <header className="mb-5">
        <h2 className="font-display text-xl tracking-tight text-[var(--color-foreground)]">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{subtitle}</p>}
      </header>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-[var(--color-foreground)]">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--color-muted-foreground)]">{hint}</span>}
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="flex items-baseline justify-between">
        <span className="font-medium text-[var(--color-foreground)]">{label}</span>
        <span className="font-mono text-xs text-[var(--color-primary)]">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--color-muted)] accent-[var(--color-primary)]"
      />
    </label>
  );
}

/**
 * Toggle d'héritage des blocs admin + icône (?) avec popup hover
 * affichant le contenu effectif que le tenant hérite pour son plan.
 */
function InheritToggle({
  checked,
  onChange,
  planLabel,
  preview,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  planLabel: string;
  preview: string;
}) {
  const [showPopup, setShowPopup] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 cursor-pointer rounded border-[var(--color-border)] accent-[var(--color-primary)]"
          />
          <span className="font-medium text-[var(--color-foreground)]">
            Hériter du prompt global admin (plan{" "}
            <strong>{planLabel}</strong>)
          </span>
        </label>
        <div className="relative">
          <button
            type="button"
            onMouseEnter={() => setShowPopup(true)}
            onMouseLeave={() => setShowPopup(false)}
            onFocus={() => setShowPopup(true)}
            onBlur={() => setShowPopup(false)}
            onClick={() => setShowPopup((v) => !v)}
            aria-label="Voir le contenu hérité"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-muted)] text-[10px] font-bold text-[var(--color-muted-foreground)] hover:bg-[var(--color-primary)] hover:text-white"
          >
            ?
          </button>
          {showPopup && (
            <div className="absolute right-0 top-7 z-50 w-[min(90vw,560px)] rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-xl">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-primary)]">
                Blocs admin hérités · plan {planLabel}
              </p>
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--color-foreground)]">
                {preview || "(aucun bloc admin configuré pour ce plan)"}
              </pre>
            </div>
          )}
        </div>
      </div>
      <p className="text-xs text-[var(--color-muted-foreground)]">
        Coché : le tenant reçoit les directives système définies par
        l&apos;admin pour son plan (heures, numéros, fin d&apos;appel,
        config blocs, règles transverses, contexte per-call). Décoché :
        seuls la persona et la directive de langue sont injectées.
      </p>
    </div>
  );
}
