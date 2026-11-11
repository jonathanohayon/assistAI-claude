"use client";

/**
 * Voice brick — the ONE voice settings screen (spec §3), used as is by the
 * receptionist and by outbound agents. It edits the voice the viewer was
 * served (voice-client.ts, the tenant-safe contract subset) and hands every
 * change back through `onChange`; the server validates with mergeVoice.
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
import { useEffect, useId, useRef, useState } from "react";

import { ChipGroup, FOCUS, HINT, LABEL, Segmented, ToggleRow, radioKeys } from "@/components/bricks/controls";
import { MoreSettings } from "@/components/bricks/MoreSettings";
import { useDeveloperMode } from "@/components/bricks/use-developer-mode";
import { useVoiceSample } from "./use-voice-samples";
import { markSampleMissing } from "./voice-samples-store";
import { AdminBadge } from "@/app/[locale]/dashboard/config/shared-ui";
import { useVoiceLabel } from "@/lib/use-voice-label";
import {
  STYLE_SELECTOR_TENANT_VISIBLE,
  VOICE_GENDER,
  VOICE_IDS,
  VOICE_PACES as PACES,
  VOICE_STYLES,
  mergeClientVoice,
  type ClientVoice,
} from "./voice-client";

import {
  ADVANCED_LIMITS,
  SPEED_LIMITS,
  KEY_TERM_MAX,
  OUR_ADVANCED_FIELDS,
  PRONUNCIATION_MAX,
  addKeyTerm,
  addPronunciation,
  patienceToScreen,
  choiceVoices,
  hasDescriptor,
  paceFill,
  paceNotch,
  paceResettable,
  pickerVoices,
  screenToPatience,
  selectedChoice,
  showLevel3,
  type GenderFilter,
  type Pace,
  type ServedVoiceChoice,
} from "./voice-ui";

// Admin-only: names suppliers, so it is fetched only when an admin opens it.
const VoiceAdminFields = dynamic(() => import("./VoiceAdminFields").then((m) => m.VoiceAdminFields), {
  ssr: false,
  loading: () => null,
});
const VoiceSamplesAdmin = dynamic(() => import("./VoiceAdminFields").then((m) => m.VoiceSamplesAdmin), {
  ssr: false,
  loading: () => null,
});

/**
 * Gender colours (never colour alone: the label says "féminine / masculine").
 * Feminine = rose family, masculine = cyan/teal; separate tints, never a
 * gradient between them (brand rule). Text shades are AA on their tint.
 */
const GENDER_TONE = {
  f: { card: "border-[#fbcfe8] border-s-[#db2777] bg-[#fdf2f8]", text: "text-[#9d174d]", chip: { text: "text-[#be185d]", dot: "bg-[#db2777]" } },
  m: { card: "border-[#a5f3fc] border-s-[#0e7490] bg-[#ecfeff]", text: "text-[#155e75]", chip: { text: "text-[#0e7490]", dot: "bg-[#0e7490]" } },
} as const;

export interface VoiceBrickProps {
  value: ClientVoice;
  onChange: (next: ClientVoice) => void;
  isAdmin: boolean;
  /** Admin acting on a tenant: that tenant's developer mode. */
  asUserId?: string | null;
  /** Voices offered (default: all). */
  availableVoices?: readonly string[];
  /**
   * A quiet link to the screen's Live Test panel, for layouts where it isn't
   * beside the brick. No "Try it" button: the panel is the one place to test.
   * `direction`: where the panel is; `className`: when the link shows (e.g.
   * "xl:hidden" when the panel sits beside the form from xl).
   */
  liveTestLink?: { targetId: string; direction: "up" | "down"; className?: string };
  /** Sample override (mock pages). Default: the shared sample list
   *  (V7) in the agent's language. Listen only shows when a sample exists. */
  sampleUrl?: (voiceId: string, style: ClientVoice["style"]) => string | null;
  primaryLanguage?: string | null;
  /**
   * Receptionist (V8c): the server's voice choice for the account's engine.
   * The picker then lists OUR ids and sends one as voiceId; Listen plays only
   * the server's sample (the real voice). Absent: today's voice list.
   */
  choice?: ServedVoiceChoice | null;
  /**
   * Show the pace slider (level 1). Only where the call honours `pace`:
   * the receptionist today. Outbound agents don't (their call reads the
   * legacy speed column), so no control there — and their save never
   * touches that speed.
   */
  showPace?: boolean;
}

export function VoiceBrick({
  value,
  onChange,
  isAdmin,
  asUserId,
  availableVoices = VOICE_IDS,
  liveTestLink,
  sampleUrl,
  primaryLanguage,
  choice,
  showPace = false,
}: VoiceBrickProps) {
  const t = useTranslations("VoiceBrick");
  const dev = useDeveloperMode(asUserId);
  const sampleLanguage = primaryLanguage === "he" || primaryLanguage === "en" ? primaryLanguage : "fr";
  const listedSample = useVoiceSample(sampleLanguage);
  const sampleFor = sampleUrl ?? listedSample;
  const [error, setError] = useState<string | null>(null);

  const apply = (patch: Record<string, unknown>) => {
    const r = mergeClientVoice(value, patch);
    if (r.ok) {
      setError(null);
      onChange(r.value);
    } else {
      setError(r.error);
    }
  };
  const applyAdvanced = (patch: Partial<ClientVoice["advanced"]>) => apply({ advanced: patch });

  const styleVisible = isAdmin || STYLE_SELECTOR_TENANT_VISIBLE;

  // Choice mode: the voice name as served, to send back when the customer
  // re-picks the voice the calls already use (no change, nothing to save).
  const servedName = useRef(value.voiceId);
  useEffect(() => {
    if (choice && !choice.options.some((o) => o.id === value.voiceId)) servedName.current = value.voiceId;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a new choice is served
  }, [choice]);
  const chosen = choice ? selectedChoice(choice, value.voiceId) : null;
  const sample = choice
    ? (choice.options.find((o) => o.id === chosen)?.sampleUrl ?? null)
    : sampleFor(value.voiceId, value.style);

  return (
    <div className="flex flex-col gap-5">
      {/* ── Level 1 ─────────────────────────────────────────── */}
      {choice ? (
        <ChoicePicker
          choice={choice}
          value={chosen}
          onPick={(id) => apply({ voiceId: id === choice.current ? servedName.current : id })}
        />
      ) : (
        <VoicePicker
          value={value.voiceId}
          available={availableVoices}
          onPick={(voiceId) => apply({ voiceId })}
        />
      )}

      {styleVisible && (
        <ChipGroup
          label={t("styleLabel")}
          badge={!STYLE_SELECTOR_TENANT_VISIBLE ? <AdminBadge size="xs" /> : null}
          options={VOICE_STYLES.map((s) => ({ id: s, label: t(`style.${s}`) }))}
          selected={value.style}
          onPick={(style) => apply({ style })}
        />
      )}

      {/* Pace (V9b): level 1, the same on every engine. */}
      {showPace && <PaceSlider value={value} onPace={(pace) => apply({ pace })} />}

      <TestActions sample={sample} liveTestLink={liveTestLink} />

      {error && (
        <p role="alert" className="text-xs font-semibold text-[#b91c1c]">
          {t("invalid")}
        </p>
      )}

      {/* ── Level 2 ─────────────────────────────────────────── */}
      <MoreSettings>
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
          hint={value.bargeIn ? t("bargeInOn") : t("bargeInOff")}
          checked={value.bargeIn}
          onChange={(bargeIn) => apply({ bargeIn })}
        />

        <ToggleRow
          label={t("languageLockLabel")}
          hint={value.languageLock ? t("languageLockOn") : t("languageLockOff")}
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
        />

        <KeyTerms value={value.keyTerms} onChange={(keyTerms) => apply({ keyTerms })} />

        <Pronunciations value={value.pronunciations} onChange={(pronunciations) => apply({ pronunciations })} />
      </MoreSettings>

      {/* ── Level 3 ─────────────────────────────────────────── */}
      {showLevel3({ isAdmin, developerMode: dev.on }) && (
        <MoreSettings level={3}>
          {/* Order, most consequential first (admin): 1. engine + model,
              2. engine-dependent settings, 3. our call limits (all a tenant
              in developer mode sees), 4. voice samples (maintenance). */}
          {isAdmin && (
            <div className="border-b border-[#e2e8f0] pb-5">
              <VoiceAdminFields value={value} onPatch={apply} primaryLanguage={primaryLanguage ?? null} />
            </div>
          )}
          <p className={HINT}>{t("developerHint")}</p>
          <div className="mt-4 grid grid-cols-1 gap-4">
            {OUR_ADVANCED_FIELDS.map((k) => (
              <NumberField
                key={k}
                label={t(`advanced.${k}`)}
                hint={t(`advancedHint.${k}`)}
                {...ADVANCED_LIMITS[k]}
                unit={t(`unit.${ADVANCED_LIMITS[k].unit}`)}
                value={value.advanced[k]}
                onChange={(n) => applyAdvanced({ [k]: n })}
              />
            ))}
            {/* The exact speed (a legacy custom value shows "Custom" on the slider). Empty = follows the pace. */}
            <SpeedField value={value.advanced.speed} onChange={(speed) => applyAdvanced({ speed })} />
          </div>
          {isAdmin && (
            <div className="mt-5 border-t border-[#e2e8f0] pt-4">
              <VoiceSamplesAdmin engine={(value as { engine?: string }).engine} />
            </div>
          )}
        </MoreSettings>
      )}
    </div>
  );
}

// ─── Level 1 parts ──────────────────────────────────────────────────────

interface PickerItem {
  id: string;
  gender: "f" | "m";
  /** First line: the descriptor, or "Voice N" when there is none. */
  title: string;
  /** Second line: "Voice N · gender", or the gender alone. */
  sub: string;
}

/** Today's list (outbound agents, previews): voices by name. */
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
  const item = (v: string): PickerItem => {
    const desc = t.has(`desc.${v}`) ? t(`desc.${v}`) : null;
    return { id: v, gender: VOICE_GENDER[v] === "m" ? "m" : "f", title: desc ?? voiceLabel(v), sub: voiceLabel(v) };
  };
  return (
    <PickerGrid
      value={value}
      total={available.length}
      shortCount={pickerVoices(available, { gender: "all", showAll: false, selected: value }).length}
      list={(gender, showAll) => pickerVoices(available, { gender, showAll, selected: value }).map(item)}
      onPick={onPick}
    />
  );
}

/** Receptionist (V8c): the server's choice, our ids, the server's numbers. */
function ChoicePicker({
  choice,
  value,
  onPick,
}: {
  choice: ServedVoiceChoice;
  value: string | null;
  onPick: (id: string) => void;
}) {
  const t = useTranslations("VoiceBrick");
  const tv = useTranslations("Voices");
  const item = (o: ServedVoiceChoice["options"][number]): PickerItem => {
    // Descriptors are written for one voice family only; elsewhere number + gender.
    const desc = hasDescriptor(o.id) && t.has(`voiceDesc.${o.id}`) ? t(`voiceDesc.${o.id}`) : null;
    return desc
      ? { id: o.id, gender: o.gender, title: desc, sub: tv("display", { n: o.number, gender: o.gender }) }
      : { id: o.id, gender: o.gender, title: tv("display", { n: o.number, gender: "other" }), sub: o.gender === "m" ? t("genderM") : t("genderF") };
  };
  return (
    <PickerGrid
      value={value}
      total={choice.options.length}
      shortCount={choiceVoices(choice, { gender: "all", showAll: false, selected: value }).length}
      list={(gender, showAll) => choiceVoices(choice, { gender, showAll, selected: value }).map(item)}
      onPick={onPick}
    />
  );
}

function PickerGrid({
  value,
  total,
  shortCount,
  list,
  onPick,
}: {
  value: string | null;
  total: number;
  shortCount: number;
  list: (gender: GenderFilter, showAll: boolean) => PickerItem[];
  onPick: (id: string) => void;
}) {
  const t = useTranslations("VoiceBrick");
  const [gender, setGender] = useState<GenderFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const labelId = useId();
  const items = list(gender, showAll);
  const ids = items.map((i) => i.id);
  const hidden = total - shortCount;
  const focusId = value && ids.includes(value) ? value : ids[0];

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
            { id: "f", label: t("genderF"), accent: GENDER_TONE.f.chip },
            { id: "m", label: t("genderM"), accent: GENDER_TONE.m.chip },
          ]}
          selected={gender}
          onPick={(g) => setGender(g as GenderFilter)}
        />
      </div>

      <div
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={radioKeys(ids, focusId ?? "", onPick)}
        className="mt-3 grid grid-cols-2 gap-2"
      >
        {items.map((v) => {
          const active = v.id === value;
          const tone = GENDER_TONE[v.gender];
          return (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${v.title}, ${v.sub}`}
              data-id={v.id}
              tabIndex={v.id === focusId ? 0 : -1}
              onClick={() => onPick(v.id)}
              className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-s-4 px-3 py-2 text-start text-[#18181b] transition-shadow duration-150 ${FOCUS} ${tone.card} ${
                active ? "ring-2 ring-[#18181b] ring-offset-2" : "hover:shadow-sm"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{v.title}</span>
                <span className={`block truncate text-xs font-medium ${tone.text}`}>{v.sub}</span>
              </span>
              {/* Selected: one treatment on both tints (dark ring + check). */}
              {active && (
                <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-[#18181b]">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className={`mt-2 min-h-11 cursor-pointer rounded-lg px-1 text-sm font-semibold text-[#be185d] underline-offset-4 hover:underline ${FOCUS}`}
        >
          {showAll ? t("fewerVoices") : t("allVoices", { count: total })}
        </button>
      )}
    </div>
  );
}

function TestActions({
  sample,
  liveTestLink,
}: {
  sample: string | null;
  liveTestLink?: VoiceBrickProps["liveTestLink"];
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

  if (!sample && !liveTestLink) return null;

  const toggle = () => {
    if (!sample) return;
    if (playing) {
      audio.current?.pause();
      setPlayingSample(null);
      return;
    }
    const a = new Audio(sample);
    a.onended = () => setPlayingSample(null);
    a.onerror = () => {
      setPlayingSample(null);
      // Deleted since the list was read (404): hide the button.
      markSampleMissing(sample);
    };
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
      {liveTestLink && (
        <a
          href={`#${liveTestLink.targetId}`}
          onClick={(e) => {
            const el = document.getElementById(liveTestLink.targetId);
            if (!el) return;
            e.preventDefault();
            el.scrollIntoView({ behavior: "smooth", block: "start" });
            el.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
          }}
          className={`inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm font-semibold text-[#0e7490] underline-offset-4 hover:underline ${FOCUS} ${liveTestLink.className ?? ""}`}
        >
          {t("liveTestLink")}
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${liveTestLink.direction === "up" ? "rotate-180" : ""}`}>
            <path d="M12 5v14M6 13l6 6 6-6" />
          </svg>
        </a>
      )}
    </div>
  );
}


/** The pace thumb (the native track is transparent; ours is drawn behind it). */
const PACE_THUMB = [
  "[&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent",
  "[&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[#be185d] [&::-webkit-slider-thumb]:shadow",
  "[&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[#be185d] [&::-moz-range-thumb]:shadow",
].join(" ");

/**
 * Pace (V9b): five notches, Very slow … Very fast, "Normal" marked in the
 * centre; the value in words, never a number. A legacy custom speed sits on
 * the nearest notch and reads "Custom" until the slider or Reset is touched
 * (the exact number stays in developer settings). Native range input: in
 * right-to-left it runs from the right (Very slow) to the left (Very fast)
 * and the arrow keys follow what the eye sees.
 */
function PaceSlider({ value, onPace }: { value: ClientVoice; onPace: (pace: Pace) => void }) {
  const t = useTranslations("VoiceBrick");
  const id = useId();
  const { index, custom } = paceNotch(value);
  const words = custom ? t("pace.custom") : t(`pace.${PACES[index]}`);
  const commit = (i: number) => onPace(PACES[i]);
  // Touching the slider clears a custom speed even when the notch doesn't move.
  const touch = (e: React.SyntheticEvent<HTMLInputElement>) => {
    if (custom) commit(Number(e.currentTarget.value));
  };
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={LABEL}>
          {t("paceLabel")}
        </label>
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-semibold text-[#18181b]" aria-hidden>
            {words}
          </span>
          {paceResettable(value) && (
            <button
              type="button"
              onClick={() => onPace("normal")}
              className={`min-h-11 cursor-pointer rounded-lg px-1 text-sm font-semibold text-[#be185d] underline-offset-4 hover:underline ${FOCUS}`}
            >
              {t("paceReset")}
            </button>
          )}
        </div>
      </div>
      {/* Pace is a deviation from Normal, not a quantity: the track fills from
          the centre mark to the thumb (empty at Normal). Our own track behind a
          transparent native one; `inset-inline-start` mirrors it in RTL like
          the native range. Insets = thumb half-width (10 px). */}
      <div className="relative mt-1 h-11">
        <div aria-hidden className="absolute inset-x-2.5 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#e2e8f0]">
          <div data-pace-fill className="absolute inset-y-0 rounded-full bg-[#be185d]" style={paceFill(index, PACES.length)} />
        </div>
        <input
          id={id}
          type="range"
          min={0}
          max={PACES.length - 1}
          step={1}
          value={index}
          aria-valuetext={words}
          onChange={(e) => commit(Number(e.target.value))}
          onPointerUp={touch}
          onKeyUp={touch}
          className={`relative h-11 w-full cursor-pointer appearance-none bg-transparent ${PACE_THUMB} ${FOCUS}`}
        />
      </div>
      {/* Notches under the track, aligned with the thumb stops; Normal's is taller and darker. */}
      <div aria-hidden className="flex justify-between px-2.5">
        {PACES.map((p) => (
          <span key={p} className={p === "normal" ? "h-3 w-0.5 rounded bg-[#18181b]" : "h-2 w-px bg-[#94a3b8]"} />
        ))}
      </div>
      <div aria-hidden className="mt-1 grid grid-cols-3 text-xs text-[#475569]">
        <span className="text-start">{t("pace.very_slow")}</span>
        <span className="text-center">{t("pace.normal")}</span>
        <span className="text-end">{t("pace.very_fast")}</span>
      </div>
    </div>
  );
}

/** Developer settings: the exact speed, or empty to follow the pace. */
function SpeedField({ value, onChange }: { value: number | null; onChange: (speed: number | null) => void }) {
  const t = useTranslations("VoiceBrick");
  const id = useId();
  const [editing, setEditing] = useState<string | null>(null);
  const draft = editing ?? (value === null ? "" : String(value));
  const commit = () => {
    setEditing(null);
    const raw = draft.trim().replace(",", ".");
    if (raw === "") {
      if (value !== null) onChange(null);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(SPEED_LIMITS.max, Math.max(SPEED_LIMITS.min, Math.round(n * 100) / 100));
    if (clamped !== value) onChange(clamped);
  };
  return (
    <div>
      <label htmlFor={id} className="text-xs font-semibold text-[#18181b]">
        {t("advanced.speed")}
      </label>
      <p id={`${id}-hint`} className="mt-0.5 text-xs leading-snug text-[#475569]">
        {t("advancedHint.speed")}
      </p>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        dir="ltr"
        value={draft}
        placeholder={t("speedFollowsPace")}
        aria-describedby={`${id}-hint`}
        onChange={(e) => setEditing(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className={`mt-1 min-h-11 w-full rounded-xl border border-[#e2e8f0] bg-white px-3 text-sm text-[#18181b] ${FOCUS}`}
      />
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
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  value: number;
  minLabel: string;
  maxLabel: string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
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
  hint,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  hint: string;
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
      <p id={`${id}-hint`} className="mt-0.5 text-xs leading-snug text-[#475569]">
        {hint}
      </p>
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
          aria-describedby={`${id}-hint`}
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
  value: ClientVoice["pronunciations"];
  onChange: (v: ClientVoice["pronunciations"]) => void;
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
