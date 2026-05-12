"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";

import { LiveTestPanel } from "@/components/LiveTestPanel";
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
};

export function ConfigForm({
  initial,
  isAdmin = false,
}: {
  initial: FormState;
  isAdmin?: boolean;
}) {
  const t = useTranslations("DashboardConfig");
  const locale = useLocale();
  const [form, setForm] = useState<FormState>(initial);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();

  const catalog = useRealtimeCatalog();
  const availableVoices = useMemo(
    () => voicesForCatalog(catalog, form.model),
    [catalog, form.model],
  );

  // Reconstruit l'array PRIMARY_LANGUAGES à chaque render pour bénéficier
  // des labels traduits. 3 entrées seulement → coût négligeable.
  const primaryLanguages = [
    { value: "fr", label: t("langFr") },
    { value: "he", label: t("langHe") },
    { value: "en", label: t("langEn") },
  ];

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
      const res = await fetch("/api/dashboard/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? t("errSaveFailed"));
        return;
      }
      const timeLocale = locale === "he" ? "he-IL" : locale === "en" ? "en-US" : "fr-FR";
      setSavedAt(new Date().toLocaleTimeString(timeLocale));
      setDirty(false);
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {/* Persona */}
      <Card title={t("personaTitle")} subtitle={t("personaSubtitle")}>
        <Field
          label={t("primaryLanguageLabel")}
          hint={t("primaryLanguageHint")}
        >
          <select
            value={form.primaryLanguage}
            onChange={(e) => update("primaryLanguage", e.target.value)}
            className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
          >
            {primaryLanguages.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("instructionsLabel")} hint={t("instructionsHint")}>
          <textarea
            value={form.instructions}
            onChange={(e) => update("instructions", e.target.value)}
            rows={20}
            className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
          />
        </Field>

        <Field label={t("greetingLabel")} hint={t("greetingHint")}>
          <textarea
            value={form.greetingInstructions}
            onChange={(e) => update("greetingInstructions", e.target.value)}
            rows={3}
            placeholder={t("greetingPlaceholder")}
            className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm leading-relaxed text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
          />
        </Field>
      </Card>

      {/* Notifications */}
      <Card title={t("whatsappTitle")} subtitle={t("whatsappSubtitle")}>
        <Field
          label={t("ownerWhatsappLabel")}
          hint={t("ownerWhatsappHint")}
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
          {t("whatsappFooter")}
        </p>
      </Card>

      {/* Voice config */}
      <Card
        title={t("voiceTitle")}
        subtitle={
          isAdmin ? t("voiceSubtitleAdmin") : t("voiceSubtitleUser")
        }
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {isAdmin && (
            <Field label={t("modelLabel")} hint={t("modelHint")}>
              <select
                value={form.model}
                onChange={(e) => update("model", e.target.value)}
                className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
              >
                {catalog.models.map((m) => m.id).map((m) => (
                  <option key={m} value={m}>
                    {m} ·{" "}
                    {catalog.models.find((r) => r.id === m)?.provider ?? "?"}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label={t("voiceLabel")}>
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
            label={t("speedLabel")}
            value={form.speed}
            min={0.5}
            max={1.5}
            step={0.05}
            onChange={(v) => update("speed", v)}
            hint={t("speedHint")}
            display={form.speed.toFixed(2) + "×"}
          />

          {isAdmin && (
            <>
              <Slider
                label={t("temperatureLabel")}
                value={form.temperature}
                min={0}
                max={1.2}
                step={0.05}
                onChange={(v) => update("temperature", v)}
                hint={t("temperatureHint")}
                display={form.temperature.toFixed(2)}
              />

              <Field
                label={t("maxTokensLabel")}
                hint={t("maxTokensHint")}
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
                {t("unsavedChanges")}
              </span>
            ) : savedAt ? (
              <span className="text-[var(--color-success)]">
                {t("savedAt", { time: savedAt })}
              </span>
            ) : (
              <span className="text-[var(--color-muted-foreground)]">
                {t("upToDate")}
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={isPending || !dirty}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white shadow-md transition-transform enabled:hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? t("saving") : t("saveButton")}
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
