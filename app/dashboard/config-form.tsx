"use client";

import { useMemo, useState, useTransition } from "react";

import { LiveTestPanel } from "@/components/LiveTestPanel";
import { REALTIME_MODELS, voicesFor } from "@/lib/realtime";

type FormState = {
  instructions: string;
  greetingInstructions: string;
  model: string;
  voice: string;
  temperature: number;
  speed: number;
  maxResponseTokens: number;
  ownerWhatsapp: string;
};

export function ConfigForm({
  initial,
  isAdmin = false,
  modelIds,
}: {
  initial: FormState;
  isAdmin?: boolean;
  modelIds?: string[];
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();

  const availableVoices = useMemo(() => voicesFor(form.model), [form.model]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setDirty(true);
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "model") {
        const allowed = voicesFor(value as string);
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
      const res = await fetch("/api/dashboard/config", {
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
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {/* Persona */}
      <Card
        title="Persona"
        subtitle="La grosse string système qui définit l'identité, le style et les workflows."
      >
        <Field
          label="Instructions"
          hint="Markdown supporté. Décrivez prénom + nom du centre, horaires, prestations, ton, et les workflows à respecter."
        >
          <textarea
            value={form.instructions}
            onChange={(e) => update("instructions", e.target.value)}
            rows={20}
            className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
          />
        </Field>

        <Field
          label="Phrase d'entrée"
          hint="Première phrase prononcée à chaque appel — avant que la cliente parle. Garde-la courte et chaleureuse (1 à 2 phrases). Ex : « Bonjour, c'est Johana du centre Prestige, comment puis-je vous aider ? »"
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

      {/* Notifications */}
      <Card
        title="Notifications WhatsApp"
        subtitle="Après chaque appel, un récap est envoyé par WhatsApp à la cliente et au propriétaire."
      >
        <Field
          label="Numéro WhatsApp du propriétaire"
          hint="Format international, ex: +972585001007. Laisse vide pour désactiver."
        >
          <input
            type="tel"
            inputMode="tel"
            placeholder="+972..."
            value={form.ownerWhatsapp}
            onChange={(e) => update("ownerWhatsapp", e.target.value)}
            className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 font-mono text-sm text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
          />
        </Field>
        <p className="rounded-xl bg-[var(--color-muted)]/60 px-4 py-3 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
          La cliente reçoit aussi un récap si Twilio détecte qu&apos;elle accepte les
          messages WhatsApp depuis son numéro d&apos;appel. Configure
          <code className="mx-1 rounded bg-white/60 px-1.5 py-0.5 font-mono">TWILIO_WHATSAPP_FROM</code>
          côté Railway pour activer l&apos;envoi.
        </p>
      </Card>

      {/* Voice config */}
      <Card
        title="Voix"
        subtitle={
          isAdmin
            ? "Paramètres techniques du moteur vocal. Visible admin uniquement."
            : "Choisis la voix de ton agent et sa vitesse de parole."
        }
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {isAdmin && modelIds && (
            <Field
              label="Modèle"
              hint="Visible uniquement pour l'admin · sert au testing cross-modèles."
            >
              <select
                value={form.model}
                onChange={(e) => update("model", e.target.value)}
                className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
              >
                {modelIds.map((m) => (
                  <option key={m} value={m}>
                    {m} ·{" "}
                    {REALTIME_MODELS.find((r) => r.id === m)?.provider ?? "?"}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Voix">
            <select
              value={form.voice}
              onChange={(e) => update("voice", e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
            >
              {availableVoices.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>

          <Slider
            label="Vitesse de parole"
            value={form.speed}
            min={0.5}
            max={1.5}
            step={0.05}
            onChange={(v) => update("speed", v)}
            hint="1.0 = naturel · 1.2 = plus rapide"
            display={form.speed.toFixed(2) + "×"}
          />

          {isAdmin && (
            <>
              <Slider
                label="Température"
                value={form.temperature}
                min={0}
                max={1.2}
                step={0.05}
                onChange={(v) => update("temperature", v)}
                hint="0 = déterministe · 1 = très créatif (admin)"
                display={form.temperature.toFixed(2)}
              />

              <Field
                label="Max tokens / réponse"
                hint="Hint via prompt — 220 ≈ 1 ou 2 phrases courtes (admin)"
              >
                <input
                  type="number"
                  min={50}
                  max={1000}
                  step={10}
                  value={form.maxResponseTokens}
                  onChange={(e) =>
                    update("maxResponseTokens", Number(e.target.value))
                  }
                  className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
                />
              </Field>
            </>
          )}
        </div>
      </Card>

      {/* Live test — uses current form values, no save required */}
      <LiveTestPanel
        model={form.model}
        voice={form.voice}
        instructions={form.instructions}
        greetingInstructions={form.greetingInstructions}
        temperature={form.temperature}
        speed={form.speed}
        dirty={dirty}
      />

      {/* Save bar — sticky at bottom */}
      <div className="sticky bottom-4 z-30 mt-2">
        <div className="flex items-center justify-between gap-4 rounded-full border border-[var(--color-border)] bg-white/95 px-4 py-2 shadow-lg backdrop-blur">
          <div className="flex items-center gap-2 text-xs">
            {error ? (
              <span className="font-medium text-[var(--color-destructive)]">
                {error}
              </span>
            ) : dirty ? (
              <span className="text-[var(--color-warning)]">
                Modifications non sauvegardées
              </span>
            ) : savedAt ? (
              <span className="text-[var(--color-success)]">
                Sauvegardé à {savedAt}
              </span>
            ) : (
              <span className="text-[var(--color-muted-foreground)]">
                À jour
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={isPending || !dirty}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white shadow-md transition-transform enabled:hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
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
        {subtitle && (
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            {subtitle}
          </p>
        )}
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
      {hint && (
        <span className="text-xs text-[var(--color-muted-foreground)]">{hint}</span>
      )}
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
  hint,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
  display: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="flex items-baseline justify-between">
        <span className="font-medium text-[var(--color-foreground)]">{label}</span>
        <span className="font-mono text-xs text-[var(--color-primary)]">
          {display}
        </span>
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
      {hint && (
        <span className="text-xs text-[var(--color-muted-foreground)]">{hint}</span>
      )}
    </label>
  );
}
