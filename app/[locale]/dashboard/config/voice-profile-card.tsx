"use client";

/**
 * Admin-only "Voice profile" card (Voice tile). Fields come from
 * lib/voice-profile VOICE_PROFILE_FIELDS, grouped in 3 sections:
 *   (a) works on every engine, (b) our controls, (c) extras for the
 *   selected engine only.
 * Every setting has an "i" (InfoTip): what it does, how to use it, and its
 * range / default / supported engines.
 *
 * Loaded with next/dynamic from the voice panel, and its copy lives in the
 * admin-only "AdminVoiceProfile" namespace, so none of this reaches tenants.
 * Values not set yet fall back to the field default (= today's behaviour),
 * so saving an untouched card changes nothing.
 */

import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { InfoTip } from "@/components/ui/InfoTip";
import { effectiveRealtimeProvider, type RealtimeProvider } from "@/lib/realtime-provider";
import { VOICE_PROFILE_FIELDS, type VoiceProfileField } from "@/lib/voice-profile";

import type { FormState, FormUpdater } from "./types";

type Pronunciation = { term: string; sayAs: string };
type Values = Record<string, unknown>;

/** Isolate a numeric/LTR run inside RTL text (FSI … PDI). */
const iso = (s: string) => `⁨${s}⁩`;

const INPUT =
  "w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-[#18181b] shadow-xs focus:border-[#0e7490] focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15";

function isVisible(field: VoiceProfileField, values: Values): boolean {
  if (!field.visibleWhen) return true;
  const { key, equals } = field.visibleWhen;
  const dep = VOICE_PROFILE_FIELDS.find((f) => f.key === key);
  const v = key in values ? values[key] : dep?.default;
  return v === equals;
}

export function VoiceProfileCard({
  form,
  update,
}: {
  form: FormState;
  update: FormUpdater;
}) {
  const t = useTranslations("AdminVoiceProfile");
  const locale = useLocale();
  const provider = effectiveRealtimeProvider(form.realtimeProvider);
  const values: Values = (form.voiceProfile ?? {}) as Values;

  const get = (f: VoiceProfileField) => (f.key in values ? values[f.key] : f.default);
  const set = (key: string, v: unknown) => update("voiceProfile", { ...values, [key]: v });
  const isDefault = (f: VoiceProfileField) =>
    JSON.stringify(get(f)) === JSON.stringify(f.default);

  const fmt = (n: number) => n.toLocaleString(locale === "he" ? "he-IL" : locale === "en" ? "en-US" : "fr-FR");
  const num = (n: number) => iso(fmt(n));
  const unit = (f: VoiceProfileField) => (f.unit ? t(`unit.${f.unit}`) : "");
  // One isolated LTR run for the whole range: isolating each number on its
  // own made "1–5" display as "5–1" in Hebrew.
  const range = (min: number, max: number, u: string) =>
    iso(`${fmt(min)}–${fmt(max)}${u ? ` ${u}` : ""}`);
  const valueLabel = (f: VoiceProfileField, v: unknown): string => {
    if (typeof v === "boolean") return v ? t("on") : t("off");
    if (typeof v === "number") return `${num(v)}${unit(f) ? ` ${unit(f)}` : ""}`;
    if (Array.isArray(v)) return v.length ? String(v.length) : t("none");
    if (typeof v === "string" && f.options) return t(`options.${f.key}.${v}`);
    return v ? String(v) : t("none");
  };
  const engineNames = (engines: readonly RealtimeProvider[]) =>
    engines.length >= 3 ? t("allEngines") : engines.map((e) => t(`engine.${e}`)).join(", ");
  const meta = (f: VoiceProfileField) =>
    [
      f.min !== undefined && f.max !== undefined
        ? t("metaRange", { range: range(f.min, f.max, unit(f)) })
        : null,
      t("metaDefault", { value: valueLabel(f, f.default) }),
      t("metaEngines", { engines: engineNames(f.engines) }),
    ]
      .filter(Boolean)
      .join(" · ");

  const sections: Array<{ id: VoiceProfileField["section"]; fields: VoiceProfileField[] }> = [
    { id: "all", fields: VOICE_PROFILE_FIELDS.filter((f) => f.section === "all") },
    { id: "ours", fields: VOICE_PROFILE_FIELDS.filter((f) => f.section === "ours") },
    {
      id: "engine",
      fields: VOICE_PROFILE_FIELDS.filter((f) => f.section === "engine" && f.engines.includes(provider)),
    },
  ];

  return (
    <section
      aria-labelledby="voice-profile-title"
      className="rounded-2xl border border-[#e2e8f0] bg-white/80 p-4 sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 id="voice-profile-title" className="text-sm font-bold tracking-tight text-[#18181b]">
          {t("title")}
        </h4>
        <button
          type="button"
          onClick={() => update("voiceProfile", null)}
          className="rounded-full border border-[#e2e8f0] px-3 py-1 text-[11px] font-semibold text-[#475569] hover:bg-[#f8fafc]"
        >
          {t("resetAll")}
        </button>
      </div>

      {sections.map((s) => (
        <fieldset key={s.id} className="mt-4 first-of-type:mt-0">
          <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]">
            {s.id === "engine" ? t("section.engine", { engine: t(`engine.${provider}`) }) : t(`section.${s.id}`)}
          </legend>

          {s.id === "ours" && (
            <NoiseReductionRow form={form} update={update} t={t} num={num} range={range} />
          )}

          {s.fields.length === 0 && s.id === "engine" && (
            <p className="text-[12px] text-[#64748b]">{t("engineNone", { engine: t(`engine.${provider}`) })}</p>
          )}

          <div className="flex flex-col gap-3">
            {s.fields
              .filter((f) => isVisible(f, values))
              .map((f) => (
                <FieldRow
                  key={f.key}
                  field={f}
                  value={get(f)}
                  modified={!isDefault(f)}
                  onChange={(v) => set(f.key, v)}
                  label={t(`fields.${f.key}.label`)}
                  what={t(`fields.${f.key}.what`)}
                  tip={t(`fields.${f.key}.tip`)}
                  meta={meta(f)}
                  t={t}
                  valueLabel={(v) => valueLabel(f, v)}
                />
              ))}
          </div>
        </fieldset>
      ))}
    </section>
  );
}

type T = ReturnType<typeof useTranslations<"AdminVoiceProfile">>;

function Label({
  htmlFor,
  text,
  tipId,
  tip,
  modified,
  t,
}: {
  htmlFor?: string;
  text: string;
  tipId: string;
  tip: { what: string; tip: string; meta: string };
  modified: boolean;
  t: T;
}) {
  return (
    <div className="mb-1 flex items-center gap-1 text-[12px] font-semibold text-[#334155]">
      {htmlFor ? <label htmlFor={htmlFor}>{text}</label> : <span>{text}</span>}
      <InfoTip id={tipId} label={t("about", { setting: text })} what={tip.what} tip={tip.tip} meta={tip.meta} />
      {modified && (
        <span className="ms-1 h-1.5 w-1.5 rounded-full bg-[#be185d]" title={t("modified")} aria-label={t("modified")} />
      )}
    </div>
  );
}

function FieldRow({
  field: f,
  value,
  modified,
  onChange,
  label,
  what,
  tip,
  meta,
  t,
  valueLabel,
}: {
  field: VoiceProfileField;
  value: unknown;
  modified: boolean;
  onChange: (v: unknown) => void;
  label: string;
  what: string;
  tip: string;
  meta: string;
  t: T;
  valueLabel: (v: unknown) => string;
}) {
  const base = useId();
  const controlId = `${base}-c`;
  const tipId = `${base}-tip`;
  const labelProps = { text: label, tipId, tip: { what, tip, meta }, modified, t };

  if (f.kind === "toggle") {
    const on = value === true;
    return (
      <div className="flex items-center justify-between gap-3">
        <Label {...labelProps} />
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          aria-describedby={tipId}
          onClick={() => onChange(!on)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-[#0e7490]/20 ${on ? "bg-[#0e7490]" : "bg-[#cbd5e1]"}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[inset-inline-start] ${on ? "start-[1.375rem]" : "start-0.5"}`}
          />
        </button>
      </div>
    );
  }

  if (f.kind === "slider") {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor={controlId} {...labelProps} />
          <span className="text-[12px] font-semibold tabular-nums text-[#0e7490]">{valueLabel(value)}</span>
        </div>
        <input
          id={controlId}
          type="range"
          min={f.min}
          max={f.max}
          step={f.step ?? 1}
          value={Number(value)}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-describedby={tipId}
          aria-valuetext={valueLabel(value)}
          className="w-full accent-[#0e7490]"
        />
      </div>
    );
  }

  if (f.kind === "number") {
    return (
      <div>
        <Label htmlFor={controlId} {...labelProps} />
        <div className="flex items-center gap-2">
          <input
            id={controlId}
            type="number"
            inputMode="numeric"
            min={f.min}
            max={f.max}
            step={f.step ?? 1}
            value={Number(value)}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(Math.min(f.max ?? n, Math.max(f.min ?? n, n)));
            }}
            aria-describedby={tipId}
            className={`${INPUT} max-w-[8rem]`}
          />
          {f.unit && <span className="text-[12px] text-[#64748b]">{t(`unit.${f.unit}`)}</span>}
        </div>
      </div>
    );
  }

  if (f.kind === "select") {
    return (
      <div>
        <Label htmlFor={controlId} {...labelProps} />
        <select
          id={controlId}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={tipId}
          className={INPUT}
        >
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {t(`options.${f.key}.${o}`)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (f.kind === "text" && f.default !== null && typeof f.default === "object") {
    // Per-engine values (voiceOverrides): one optional input per engine.
    const v = (value && typeof value === "object" ? value : {}) as Record<string, string | undefined>;
    return (
      <div>
        <Label {...labelProps} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {f.engines.map((e) => (
            <label key={e} className="block">
              <span className="mb-0.5 block text-[11px] text-[#64748b]">{t(`engine.${e}`)}</span>
              <input
                value={v[e] ?? ""}
                maxLength={f.maxLength ?? 40}
                onChange={(ev) => {
                  const next = { ...v, [e]: ev.target.value };
                  if (!ev.target.value.trim()) delete next[e];
                  onChange(next);
                }}
                aria-describedby={tipId}
                placeholder={t(`fields.${f.key}.placeholder`)}
                dir="ltr"
                className={INPUT}
              />
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (f.kind === "text") {
    const v = typeof value === "string" ? value : "";
    return (
      <div>
        <Label htmlFor={controlId} {...labelProps} />
        <textarea
          id={controlId}
          value={v}
          maxLength={f.maxLength}
          rows={2}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={tipId}
          placeholder={t(`fields.${f.key}.placeholder`)}
          className={INPUT}
        />
        {f.maxLength && (
          <p className="mt-0.5 text-end text-[10px] tabular-nums text-[#94a3b8]">
            {iso(`${v.length}/${f.maxLength}`)}
          </p>
        )}
      </div>
    );
  }

  if (f.kind === "list" && f.list === "pronunciations") {
    return (
      <PronunciationList
        field={f}
        value={Array.isArray(value) ? (value as Pronunciation[]) : []}
        onChange={onChange}
        labelProps={labelProps}
        controlId={controlId}
        tipId={tipId}
        t={t}
      />
    );
  }

  if (f.kind === "list") {
    return (
      <TermList
        field={f}
        value={Array.isArray(value) ? (value as string[]) : []}
        onChange={onChange}
        labelProps={labelProps}
        controlId={controlId}
        tipId={tipId}
        t={t}
      />
    );
  }

  return null;
}

type LabelProps = Omit<React.ComponentProps<typeof Label>, "htmlFor">;

function TermList({
  field: f,
  value,
  onChange,
  labelProps,
  controlId,
  tipId,
  t,
}: {
  field: VoiceProfileField;
  value: string[];
  onChange: (v: unknown) => void;
  labelProps: LabelProps;
  controlId: string;
  tipId: string;
  t: T;
}) {
  const [draft, setDraft] = useState("");
  const full = f.maxItems !== undefined && value.length >= f.maxItems;
  const add = () => {
    const term = draft.trim();
    if (!term || full || value.includes(term)) return;
    onChange([...value, term]);
    setDraft("");
  };
  return (
    <div>
      <Label htmlFor={controlId} {...labelProps} />
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {value.map((term) => (
            <li key={term} className="inline-flex items-center gap-1 rounded-full bg-[#ecfeff] px-2.5 py-1 text-[12px] text-[#0e7490]">
              <bdi>{term}</bdi>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== term))}
                aria-label={t("remove", { item: term })}
                className="ms-0.5 text-[#0e7490]/70 hover:text-[#be185d]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={controlId}
          value={draft}
          maxLength={f.maxLength}
          disabled={full}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          aria-describedby={tipId}
          placeholder={t(`fields.${f.key}.placeholder`)}
          className={INPUT}
        />
        <button
          type="button"
          onClick={add}
          disabled={full || !draft.trim()}
          className="shrink-0 rounded-xl border border-[#e2e8f0] px-3 text-[12px] font-semibold text-[#0e7490] disabled:opacity-40"
        >
          {t("add")}
        </button>
      </div>
      {f.maxItems !== undefined && (
        <p className="mt-0.5 text-end text-[10px] tabular-nums text-[#94a3b8]">{iso(`${value.length}/${f.maxItems}`)}</p>
      )}
    </div>
  );
}

function PronunciationList({
  field: f,
  value,
  onChange,
  labelProps,
  controlId,
  tipId,
  t,
}: {
  field: VoiceProfileField;
  value: Pronunciation[];
  onChange: (v: unknown) => void;
  labelProps: LabelProps;
  controlId: string;
  tipId: string;
  t: T;
}) {
  const [term, setTerm] = useState("");
  const [sayAs, setSayAs] = useState("");
  const full = f.maxItems !== undefined && value.length >= f.maxItems;
  const add = () => {
    const a = term.trim();
    const b = sayAs.trim();
    if (!a || !b || full || value.some((p) => p.term === a)) return;
    onChange([...value, { term: a, sayAs: b }]);
    setTerm("");
    setSayAs("");
  };
  return (
    <div>
      <Label htmlFor={controlId} {...labelProps} />
      {value.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {value.map((p) => (
            <li key={p.term} className="flex items-center gap-2 rounded-lg bg-[#f8fafc] px-2.5 py-1.5 text-[12px] text-[#334155]">
              <bdi className="font-semibold">{p.term}</bdi>
              <span aria-hidden className="text-[#94a3b8] rtl:rotate-180">→</span>
              <span className="sr-only">{t("pronouncedAs")}</span>
              <bdi className="min-w-0 flex-1 truncate">{p.sayAs}</bdi>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.term !== p.term))}
                aria-label={t("remove", { item: p.term })}
                className="text-[#64748b] hover:text-[#be185d]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input
          id={controlId}
          value={term}
          maxLength={f.maxTerm}
          disabled={full}
          onChange={(e) => setTerm(e.target.value)}
          aria-describedby={tipId}
          aria-label={t("termLabel")}
          placeholder={t("termPlaceholder")}
          className={INPUT}
        />
        <input
          value={sayAs}
          maxLength={f.maxSayAs}
          disabled={full}
          onChange={(e) => setSayAs(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          aria-label={t("sayAsLabel")}
          placeholder={t("sayAsPlaceholder")}
          className={INPUT}
        />
        <button
          type="button"
          onClick={add}
          disabled={full || !term.trim() || !sayAs.trim()}
          className="rounded-xl border border-[#e2e8f0] px-3 py-2 text-[12px] font-semibold text-[#0e7490] disabled:opacity-40"
        >
          {t("add")}
        </button>
      </div>
    </div>
  );
}

function NoiseReductionRow({
  form,
  update,
  t,
  num,
  range,
}: {
  form: FormState;
  update: FormUpdater;
  t: T;
  num: (n: number) => string;
  range: (min: number, max: number, unit: string) => string;
}) {
  const base = useId();
  const controlId = `${base}-c`;
  const tipId = `${base}-tip`;
  const label = t("fields.noiseReduction.label");
  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between gap-2">
        <Label
          htmlFor={controlId}
          text={label}
          tipId={tipId}
          tip={{
            what: t("fields.noiseReduction.what"),
            tip: t("fields.noiseReduction.tip"),
            meta: [
              t("metaRange", { range: range(1, 10, "") }),
              t("metaDefault", { value: num(8) }),
              t("metaEngines", { engines: t("allEngines") }),
            ].join(" · "),
          }}
          modified={form.noiseReductionLevel !== 8}
          t={t}
        />
        <span className="text-[12px] font-semibold tabular-nums text-[#0e7490]">{num(form.noiseReductionLevel)}</span>
      </div>
      <input
        id={controlId}
        type="range"
        min={1}
        max={10}
        step={1}
        value={form.noiseReductionLevel}
        onChange={(e) => update("noiseReductionLevel", Number(e.target.value))}
        aria-describedby={tipId}
        className="w-full accent-[#0e7490]"
      />
    </div>
  );
}
