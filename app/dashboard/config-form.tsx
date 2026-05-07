"use client";

import { useMemo, useState, useTransition } from "react";

import { REALTIME_MODELS, voicesFor } from "@/lib/realtime";

type FormState = {
  instructions: string;
  greetingInstructions: string;
  model: string;
  voice: string;
  temperature: number;
  speed: number;
  maxResponseTokens: number;
};

export function ConfigForm({
  initial,
  modelIds,
}: {
  initial: FormState;
  modelIds: string[];
  initialVoices: readonly string[];
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const availableVoices = useMemo(() => voicesFor(form.model), [form.model]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // If model changes to a provider that doesn't support current voice, snap to first allowed.
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
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 flex flex-col gap-5"
    >
      <Field label="Instructions (persona, workflows, règles)" hint="La grosse string système. Markdown OK.">
        <textarea
          value={form.instructions}
          onChange={(e) => update("instructions", e.target.value)}
          rows={20}
          className="w-full font-mono text-xs rounded border border-zinc-300 px-3 py-2 leading-relaxed"
        />
      </Field>

      <Field label="Greeting" hint="Phrase dite au début de chaque appel.">
        <textarea
          value={form.greetingInstructions}
          onChange={(e) => update("greetingInstructions", e.target.value)}
          rows={3}
          className="w-full text-sm rounded border border-zinc-300 px-3 py-2"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Modèle">
          <select
            value={form.model}
            onChange={(e) => update("model", e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          >
            {modelIds.map((m) => (
              <option key={m} value={m}>
                {m} ·{" "}
                {REALTIME_MODELS.find((r) => r.id === m)?.provider ?? "?"}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Voix">
          <select
            value={form.voice}
            onChange={(e) => update("voice", e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          >
            {availableVoices.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>

        <Field label={`Température : ${form.temperature.toFixed(2)}`} hint="0 = déterministe, 1 = très créatif">
          <input
            type="range"
            min={0}
            max={1.2}
            step={0.05}
            value={form.temperature}
            onChange={(e) => update("temperature", Number(e.target.value))}
            className="w-full"
          />
        </Field>

        <Field label={`Vitesse : ${form.speed.toFixed(2)}`} hint="1.0 = naturel, 1.2 = plus rapide">
          <input
            type="range"
            min={0.5}
            max={1.5}
            step={0.05}
            value={form.speed}
            onChange={(e) => update("speed", Number(e.target.value))}
            className="w-full"
          />
        </Field>

        <Field label="Max tokens / réponse" hint="Hint envoyé via le prompt (220 ≈ 1-2 phrases)">
          <input
            type="number"
            min={50}
            max={1000}
            step={10}
            value={form.maxResponseTokens}
            onChange={(e) =>
              update("maxResponseTokens", Number(e.target.value))
            }
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="text-xs text-zinc-500">
          {savedAt && !error && <>Sauvegardé à {savedAt} ✓</>}
          {error && <span className="text-red-600">{error}</span>}
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-blue-600 text-white text-sm font-medium px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? "Sauvegarde…" : "Sauvegarder"}
        </button>
      </div>
    </form>
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
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-zinc-700 font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}
