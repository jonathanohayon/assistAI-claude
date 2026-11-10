"use client";

/**
 * Voice brick — the ONE voice settings screen (spec §3), used as is by the
 * receptionist and by outbound agents. It edits a `Voice` (lib/voice/contract)
 * and hands every change back through `onChange`, validated by mergeVoice.
 *
 *   Level 1, always visible: voice (+ style for admins until V6), Listen, Call me.
 *   Level 2, <MoreSettings>: pace, patience, barge-in, language lock,
 *            noise reduction, key terms, pronunciations.
 *   Level 3, developer mode: our time limits for everyone in developer mode;
 *            supplier settings (engine, model…) for admins only, loaded on
 *            demand so their code never reaches a tenant's browser.
 *
 * No supplier name appears in this file or its copy (namespace VoiceBrick).
 */

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { MoreSettings } from "@/components/bricks/MoreSettings";
import { useDeveloperMode } from "@/components/bricks/use-developer-mode";
import { AdminBadge } from "@/app/[locale]/dashboard/config/shared-ui";
import { useVoiceLabel } from "@/lib/use-voice-label";
import { PACES } from "@/lib/voice-profile";
import {
  STYLE_SELECTOR_TENANT_VISIBLE,
  VOICE_IDS,
  VOICE_STYLES,
  mergeVoice,
  paceMode,
  type Voice,
} from "@/lib/voice/contract";

import {
  ADVANCED_LIMITS,
  KEY_TERM_MAX,
  OUR_ADVANCED_FIELDS,
  PRONUNCIATION_MAX,
  addKeyTerm,
  addPronunciation,
  patienceToScreen,
  pickerVoices,
  screenToPatience,
  showLevel3,
  type GenderFilter,
} from "./voice-ui";

// Admin-only: names suppliers, so it is fetched only when an admin opens it.
const VoiceAdminFields = dynamic(() => import("./VoiceAdminFields").then((m) => m.VoiceAdminFields), {
  ssr: false,
  loading: () => null,
});

// Brand: magenta → rose for "selected", cyan focus ring (never pink → cyan).
const SELECTED =
  "border-transparent bg-gradient-to-br from-[#be185d] to-[#db2777] text-white shadow-md ring-2 ring-[#67e8f9] ring-offset-1";
const FOCUS = "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2";
const LABEL = "text-sm font-semibold text-[#18181b]";
const HINT = "mt-0.5 text-xs leading-relaxed text-[#475569]";

export interface VoiceBrickProps {
  value: Voice;
  onChange: (next: Voice) => void;
  isAdmin: boolean;
  /** Admin acting on a tenant: that tenant's developer mode. */
  asUserId?: string | null;
  /** Voices offered (default: all). */
  availableVoices?: readonly string[];
  /** "Call me": the existing test call. Hidden when absent. */
  onCallMe?: () => void;
  callMeBusy?: boolean;
  /** Sample for "Listen" (V7). The button only shows when a sample exists. */
  sampleUrl?: (voiceId: string, style: Voice["style"]) => string | null;
  /** Admin engine picker: models from the catalog. */
  catalogModels?: ReadonlyArray<{ id: string; provider: string }>;
  primaryLanguage?: string | null;
}

export function VoiceBrick({
  value,
  onChange,
  isAdmin,
  asUserId,
  availableVoices = VOICE_IDS,
  onCallMe,
  callMeBusy = false,
  sampleUrl,
  catalogModels = [],
  primaryLanguage,
}: VoiceBrickProps) {
  const t = useTranslations("VoiceBrick");
  const dev = useDeveloperMode(asUserId);
  const [error, setError] = useState<string | null>(null);

  const apply = (patch: Record<string, unknown>) => {
    const r = mergeVoice(value, patch);
    if (r.ok) {
      setError(null);
      onChange(r.value);
    } else {
      setError(r.error);
    }
  };
  const applyAdvanced = (patch: Partial<Voice["advanced"]>) => apply({ advanced: patch });

  const styleVisible = isAdmin || STYLE_SELECTOR_TENANT_VISIBLE;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Level 1 ─────────────────────────────────────────── */}
      <VoicePicker
        value={value.voiceId}
        available={availableVoices}
        onPick={(voiceId) => apply({ voiceId })}
      />

      {styleVisible && (
        <ChipGroup
          label={t("styleLabel")}
          badge={!STYLE_SELECTOR_TENANT_VISIBLE ? <AdminBadge size="xs" /> : null}
          options={VOICE_STYLES.map((s) => ({ id: s, label: t(`style.${s}`) }))}
          selected={value.style}
          onPick={(style) => apply({ style })}
        />
      )}

      <TestActions
        sample={sampleUrl?.(value.voiceId, value.style) ?? null}
        onCallMe={onCallMe}
        callMeBusy={callMeBusy}
      />

      {error && (
        <p role="alert" className="text-xs font-semibold text-[#b91c1c]">
          {t("invalid")}
        </p>
      )}

      {/* ── Level 2 ─────────────────────────────────────────── */}
      <MoreSettings>
        <ChipGroup
          label={t("paceLabel")}
          options={[
            ...PACES.map((p) => ({ id: p as string, label: t(`pace.${p}`) })),
            ...(paceMode(value) === "custom" ? [{ id: "custom", label: t("pace.custom") }] : []),
          ]}
          selected={paceMode(value) === "custom" ? "custom" : value.pace}
          onPick={(pace) => {
            if (pace !== "custom") apply({ pace });
          }}
        />

        <Slider
          label={t("patienceLabel")}
          hint={t("patienceHint")}
          min={1}
          max={5}
          value={patienceToScreen(value.patience)}
          minLabel={t("patienceMin")}
          maxLabel={t("patienceMax")}
          onChange={(screen) => apply({ patience: screenToPatience(screen) })}
        />

        <ToggleRow
          label={t("bargeInLabel")}
          hint={t("bargeInHint")}
          checked={value.bargeIn}
          onChange={(bargeIn) => apply({ bargeIn })}
        />

        <ToggleRow
          label={t("languageLockLabel")}
          hint={t("languageLockHint")}
          checked={value.languageLock}
          onChange={(languageLock) => apply({ languageLock })}
        />

        <Slider
          label={t("noiseLabel")}
          hint={t("noiseHint")}
          min={1}
          max={10}
          value={value.noiseReduction}
          minLabel={t("noiseMin")}
          maxLabel={t("noiseMax")}
          onChange={(noiseReduction) => apply({ noiseReduction })}
          showValue
        />

        <KeyTerms value={value.keyTerms} onChange={(keyTerms) => apply({ keyTerms })} />

        <Pronunciations value={value.pronunciations} onChange={(pronunciations) => apply({ pronunciations })} />
      </MoreSettings>

      {/* ── Level 3 ─────────────────────────────────────────── */}
      {showLevel3({ isAdmin, developerMode: dev.on }) && (
        <section
          aria-labelledby="voice-dev-title"
          className="rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-4"
        >
          <h3 id="voice-dev-title" className="text-sm font-semibold text-[#18181b]">
            {t("developerTitle")}
          </h3>
          <p className={HINT}>{t("developerHint")}</p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {OUR_ADVANCED_FIELDS.map((k) => (
              <NumberField
                key={k}
                label={t(`advanced.${k}`)}
                {...ADVANCED_LIMITS[k]}
                unit={t(`unit.${ADVANCED_LIMITS[k].unit}`)}
                value={value.advanced[k]}
                onChange={(n) => applyAdvanced({ [k]: n })}
              />
            ))}
          </div>
          {isAdmin && (
            <div className="mt-5 border-t border-[#e2e8f0] pt-4">
              <VoiceAdminFields
                value={value}
                onPatch={apply}
                catalogModels={catalogModels}
                primaryLanguage={primaryLanguage ?? null}
              />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ─── Level 1 parts ──────────────────────────────────────────────────────

function VoicePicker({
  value,
  available,
  onPick,
}: {
  value: string;
  available: readonly string[];
  onPick: (voiceId: string) => void;
}) {
  const t = useTranslations("VoiceBrick");
  const voiceLabel = useVoiceLabel();
  const [gender, setGender] = useState<GenderFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const labelId = useId();
  const voices = pickerVoices(available, { gender, showAll, selected: value });
  const hidden = available.length - pickerVoices(available, { gender: "all", showAll: false, selected: value }).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={labelId} className={LABEL}>
          {t("voiceLabel")}
        </h3>
        <Segmented
          label={t("genderFilter")}
          options={[
            { id: "all", label: t("genderAll") },
            { id: "f", label: t("genderF") },
            { id: "m", label: t("genderM") },
          ]}
          selected={gender}
          onPick={(g) => setGender(g as GenderFilter)}
        />
      </div>

      <div role="radiogroup" aria-labelledby={labelId} className="mt-3 grid grid-cols-2 gap-2">
        {voices.map((v) => {
          const active = v === value;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onPick(v)}
              className={`flex min-h-12 cursor-pointer items-center rounded-xl border px-3 py-2 text-start transition-colors duration-150 ${FOCUS} ${
                active ? SELECTED : "border-[#e2e8f0] bg-white text-[#18181b] hover:border-[#be185d]/40"
              }`}
            >
              <span className="text-sm font-semibold">{voiceLabel(v)}</span>
            </button>
          );
        })}
      </div>

      {!showAll && hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className={`mt-2 min-h-11 cursor-pointer rounded-lg px-1 text-sm font-semibold text-[#be185d] underline-offset-4 hover:underline ${FOCUS}`}
        >
          {t("allVoices", { count: available.length })}
        </button>
      )}
    </div>
  );
}

function TestActions({
  sample,
  onCallMe,
  callMeBusy,
}: {
  sample: string | null;
  onCallMe?: () => void;
  callMeBusy: boolean;
}) {
  const t = useTranslations("VoiceBrick");
  // The sample being played; a new sample (voice or style changed) is
  // therefore "not playing" without any state reset.
  const [playingSample, setPlayingSample] = useState<string | null>(null);
  const playing = playingSample !== null && playingSample === sample;
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audio.current?.pause(), []);
  useEffect(() => {
    audio.current?.pause();
    audio.current = null;
  }, [sample]);

  if (!sample && !onCallMe) return null;

  const toggle = () => {
    if (!sample) return;
    if (playing) {
      audio.current?.pause();
      setPlayingSample(null);
      return;
    }
    const a = new Audio(sample);
    a.onended = () => setPlayingSample(null);
    a.onerror = () => setPlayingSample(null);
    audio.current = a;
    void a.play().then(
      () => setPlayingSample(sample),
      () => setPlayingSample(null),
    );
  };

  return (
    <div className="flex flex-wrap gap-2">
      {sample && (
        <button
          type="button"
          onClick={toggle}
          aria-pressed={playing}
          className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 text-sm font-semibold text-[#18181b] hover:border-[#be185d]/40 ${FOCUS}`}
        >
          <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 text-[#be185d]">
            {playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
          </svg>
          {playing ? t("stop") : t("listen")}
        </button>
      )}
      {onCallMe && (
        <button
          type="button"
          onClick={onCallMe}
          disabled={callMeBusy}
          className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-br from-[#be185d] to-[#db2777] px-4 text-sm font-semibold text-white shadow-sm disabled:cursor-wait disabled:opacity-60 ${FOCUS}`}
        >
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z" />
          </svg>
          {t("callMe")}
        </button>
      )}
    </div>
  );
}

// ─── Small controls ─────────────────────────────────────────────────────

function Segmented({
  label,
  options,
  selected,
  onPick,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  selected: string;
  onPick: (id: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-[#f1f5f9] p-1">
      {options.map((o) => {
        const active = o.id === selected;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(o.id)}
            className={`min-h-9 cursor-pointer rounded-lg px-3 text-xs font-semibold transition-colors ${FOCUS} ${
              active ? "bg-white text-[#18181b] shadow-sm" : "text-[#475569] hover:text-[#18181b]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ChipGroup({
  label,
  badge,
  options,
  selected,
  onPick,
}: {
  label: string;
  badge?: ReactNode;
  options: Array<{ id: string; label: string }>;
  selected: string;
  onPick: (id: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-center gap-2">
        <p id={id} className={LABEL}>
          {label}
        </p>
        {badge}
      </div>
      <div role="radiogroup" aria-labelledby={id} className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => {
          const active = o.id === selected;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onPick(o.id)}
              className={`min-h-11 cursor-pointer rounded-full border px-4 text-sm font-semibold transition-colors duration-150 ${FOCUS} ${
                active ? SELECTED : "border-[#e2e8f0] bg-white text-[#18181b] hover:border-[#be185d]/40"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const labelId = useId();
  const hintId = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p id={labelId} className={LABEL}>
          {label}
        </p>
        <p id={hintId} className={HINT}>
          {hint}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={hintId}
        onClick={() => onChange(!checked)}
        className="group -m-2.5 inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full p-2.5 focus:outline-none"
      >
        <span
          aria-hidden
          className={`relative inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors duration-200 group-focus-visible:ring-2 group-focus-visible:ring-[#0e7490] group-focus-visible:ring-offset-2 ${
            checked ? "bg-gradient-to-r from-[#be185d] to-[#db2777]" : "bg-[#94a3b8]"
          }`}
        >
          <span
            className={`block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200 motion-reduce:transition-none ${
              checked ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0"
            }`}
          />
        </span>
      </button>
    </div>
  );
}

function Slider({
  label,
  hint,
  min,
  max,
  value,
  minLabel,
  maxLabel,
  onChange,
  showValue = false,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  value: number;
  minLabel: string;
  maxLabel: string;
  onChange: (v: number) => void;
  showValue?: boolean;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
        {showValue && (
          <span className="text-sm font-semibold tabular-nums text-[#be185d]" dir="ltr">
            {value} / {max}
          </span>
        )}
      </div>
      <p id={hintId} className={HINT}>
        {hint}
      </p>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-describedby={hintId}
        aria-valuetext={`${value} / ${max}`}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`mt-3 h-11 w-full cursor-pointer accent-[#be185d] ${FOCUS}`}
      />
      <div className="flex justify-between text-xs text-[#475569]">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

function NumberField({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (n: number) => void;
}) {
  const id = useId();
  // `draft` is null while not editing → the field shows the stored value.
  const [editing, setEditing] = useState<string | null>(null);
  const draft = editing ?? String(value);
  const setDraft = (v: string) => setEditing(v);
  const commit = () => {
    const n = Number(draft);
    setEditing(null);
    if (draft.trim() === "" || !Number.isFinite(n)) return;
    const clamped = Math.min(max, Math.max(min, Math.round(n / step) * step));
    if (clamped !== value) onChange(clamped);
  };
  return (
    <div>
      <label htmlFor={id} className="text-xs font-semibold text-[#18181b]">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          dir="ltr"
          className="min-h-11 w-full rounded-xl border border-[#e2e8f0] bg-white px-3 text-sm tabular-nums text-[#18181b] focus:border-[#0e7490] focus:outline-none focus:ring-2 focus:ring-[#0e7490]/20"
        />
        <span className="shrink-0 text-xs text-[#475569]">{unit}</span>
      </div>
    </div>
  );
}

function KeyTerms({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const t = useTranslations("VoiceBrick");
  const [draft, setDraft] = useState("");
  const id = useId();
  const add = () => {
    const next = addKeyTerm(value, draft);
    if (next.length !== value.length) onChange(next);
    setDraft("");
  };
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {t("keyTermsLabel")}
      </label>
      <p className={HINT}>{t("keyTermsHint")}</p>
      {value.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {value.map((term) => (
            <li key={term} className="inline-flex items-center gap-1 rounded-full bg-[#fdf2f8] ps-3 text-sm text-[#831843]">
              {term}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== term))}
                aria-label={t("remove", { item: term })}
                className={`inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full hover:bg-[#fce7f3] ${FOCUS}`}
              >
                <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3.5 w-3.5">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex gap-2">
        <input
          id={id}
          value={draft}
          maxLength={KEY_TERM_MAX.length}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={t("keyTermsPlaceholder")}
          disabled={value.length >= KEY_TERM_MAX.items}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#e2e8f0] bg-white px-3 text-sm text-[#18181b] focus:border-[#0e7490] focus:outline-none focus:ring-2 focus:ring-[#0e7490]/20"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className={`min-h-11 shrink-0 cursor-pointer rounded-xl border border-[#e2e8f0] bg-white px-4 text-sm font-semibold text-[#18181b] hover:border-[#be185d]/40 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
        >
          {t("add")}
        </button>
      </div>
    </div>
  );
}

function Pronunciations({
  value,
  onChange,
}: {
  value: Voice["pronunciations"];
  onChange: (v: Voice["pronunciations"]) => void;
}) {
  const t = useTranslations("VoiceBrick");
  const [term, setTerm] = useState("");
  const [sayAs, setSayAs] = useState("");
  const termId = useId();
  const sayId = useId();
  const add = () => {
    const next = addPronunciation(value, term, sayAs);
    if (next !== value) onChange(next);
    setTerm("");
    setSayAs("");
  };
  const input =
    "min-h-11 w-full rounded-xl border border-[#e2e8f0] bg-white px-3 text-sm text-[#18181b] focus:border-[#0e7490] focus:outline-none focus:ring-2 focus:ring-[#0e7490]/20";
  return (
    <fieldset>
      <legend className={LABEL}>{t("pronunciationsLabel")}</legend>
      <p className={HINT}>{t("pronunciationsHint")}</p>
      {value.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {value.map((p) => (
            <li key={p.term} className="flex items-center justify-between gap-2 rounded-xl bg-[#f8fafc] ps-3 text-sm">
              <span className="min-w-0">
                <span className="font-semibold text-[#18181b]">{p.term}</span>{" "}
                <span className="text-[#475569]">{t("saidAs", { sayAs: p.sayAs })}</span>
              </span>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.term !== p.term))}
                aria-label={t("remove", { item: p.term })}
                className={`inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-[#475569] hover:bg-[#f1f5f9] ${FOCUS}`}
              >
                <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3.5 w-3.5">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <div>
          <label htmlFor={termId} className="sr-only">
            {t("termLabel")}
          </label>
          <input id={termId} value={term} maxLength={PRONUNCIATION_MAX.term} onChange={(e) => setTerm(e.target.value)} placeholder={t("termLabel")} className={input} />
        </div>
        <div>
          <label htmlFor={sayId} className="sr-only">
            {t("sayAsLabel")}
          </label>
          <input id={sayId} value={sayAs} maxLength={PRONUNCIATION_MAX.sayAs} onChange={(e) => setSayAs(e.target.value)} placeholder={t("sayAsLabel")} className={input} />
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!term.trim() || !sayAs.trim() || value.length >= PRONUNCIATION_MAX.items}
          className={`min-h-11 cursor-pointer rounded-xl border border-[#e2e8f0] bg-white px-4 text-sm font-semibold text-[#18181b] hover:border-[#be185d]/40 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
        >
          {t("add")}
        </button>
      </div>
    </fieldset>
  );
}
