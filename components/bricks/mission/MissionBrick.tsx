"use client";

/**
 * Mission brick (M2b), level 1 only.
 *
 * - <MissionCards>: the campaign editor's three mission cards, which replace
 *   the goal-preset picker one for one (they read and write `goalPreset`).
 *   Each card shows its success proof, read-only, as an estimate.
 * - <DefaultMissionControl>: the agent editor's one quiet line, the agent's
 *   default mission for new campaigns.
 *
 * No level 2 / level 3: nothing on the call reads such settings yet.
 */

import { useId } from "react";
import { useTranslations } from "next-intl";

import type { EffectiveCapabilities } from "@/lib/tools/contract";

import { FOCUS, HINT, LABEL, ToggleRow, radioKeys } from "../controls";
import {
  DEFAULT_MISSION_OPTIONS,
  MISSION_CARDS,
  cardForPreset,
  defaultMissionValue,
  missionForDefaultOption,
  missionNeeds,
  presetForCard,
  proofOf,
  takesCold,
  type CardMission,
  type DefaultMissionOption,
  type ScreenMission,
} from "./mission-ui";

export function MissionCards({
  preset,
  onPresetChange,
  capabilities = null,
}: {
  /** The campaign's stored goalPreset (any string: an unknown one shows "Other"). */
  preset: string;
  /** Called only when a pick changes the preset. */
  onPresetChange: (preset: string) => void;
  /** The agent's effective capabilities, for the "Not active yet" line; null = unknown (no line). */
  capabilities?: EffectiveCapabilities | null;
}) {
  const t = useTranslations("MissionBrick");
  const tTools = useTranslations("ToolsBrick");
  const labelId = useId();
  const hintId = useId();
  const shown = cardForPreset(preset);
  const pick = (kind: CardMission, cold = kind === shown.kind ? shown.cold : false) => {
    const next = presetForCard(preset, kind, cold);
    if (next !== preset) onPresetChange(next);
  };
  const needs = missionNeeds(shown.kind, capabilities);

  return (
    <div>
      <p id={labelId} className={LABEL}>
        {t("cardsLabel")}
      </p>
      <p id={hintId} className={HINT}>
        {t("cardsHint")}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={hintId}
        onKeyDown={radioKeys(MISSION_CARDS, shown.kind, (id) => pick(id as CardMission))}
        className="mt-2 grid gap-2 sm:grid-cols-3"
      >
        {MISSION_CARDS.map((kind) => {
          const active = kind === shown.kind;
          const proofId = `${labelId}-${kind}-proof`;
          return (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={active}
              aria-describedby={proofId}
              data-id={kind}
              tabIndex={active ? 0 : -1}
              onClick={() => pick(kind)}
              className={`flex min-h-12 cursor-pointer flex-col items-start gap-1 rounded-xl border border-s-4 bg-white px-3 py-2.5 text-start text-[#18181b] transition-shadow duration-150 ${FOCUS} ${
                active ? "border-[#be185d] ring-2 ring-[#18181b] ring-offset-2" : "border-[#e2e8f0] hover:shadow-sm"
              }`}
            >
              <span className="flex w-full items-center gap-2">
                <span className="min-w-0 flex-1 text-sm font-semibold">{t(`kind.${kind}.name`)}</span>
                {active && (
                  <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </span>
              <span className="text-xs leading-relaxed text-[#475569]">{t(`kind.${kind}.what`)}</span>
              {/* Read-only: what will count as success, as an estimate (no tool proves it today). */}
              <span id={proofId} className="text-xs leading-relaxed text-[#334155]">
                <span className="font-semibold">{t("proofLabel")}</span> {t(`proof.${proofOf(kind)}`)}
              </span>
            </button>
          );
        })}
      </div>

      {takesCold(shown.kind) && (
        <div className="mt-3 rounded-xl border border-[#e2e8f0] bg-white px-3 py-3">
          <ToggleRow
            label={t("coldLabel")}
            hint={t("coldHint")}
            checked={shown.cold}
            onChange={(cold) => pick(shown.kind, cold)}
          />
        </div>
      )}

      {/* The Tools brick's "Not active yet" reading and words; display only. */}
      {needs.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-[#92400e]" aria-live="polite">
          {needs.map((n) => (
            <li key={n.key}>
              <span className="font-semibold">{tTools("statusPending")}</span> {tTools(`cap.${n.key}.name`)} —{" "}
              {n.missing ? tTools(`missing.${n.missing}`) : t("needsOff", { tools: tTools("tileLabel") })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DefaultMissionControl({
  value,
  onChange,
}: {
  /** The agent's stored mission (null = never set; a kind without a card shows unselected). */
  value: ScreenMission | null;
  onChange: (next: ScreenMission) => void;
}) {
  const t = useTranslations("MissionBrick");
  const id = useId();
  const current = defaultMissionValue(value);
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <label htmlFor={id} className="text-[13px] text-[#475569]">
        {t("defaultLabel")}
      </label>
      <select
        id={id}
        value={current}
        onChange={(e) => {
          const v = e.target.value as DefaultMissionOption | "";
          if (v) onChange(missionForDefaultOption(v));
        }}
        className={`min-h-11 rounded-xl border border-[#e2e8f0] bg-white px-3 text-sm font-semibold text-[#18181b] sm:min-w-56 ${FOCUS}`}
      >
        {current === "" && (
          <option value="" disabled>
            {t("defaultNone")}
          </option>
        )}
        {DEFAULT_MISSION_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o === "qualify_lead:cold" ? t("defaultColdOption") : t(`kind.${o}.name`)}
          </option>
        ))}
      </select>
    </div>
  );
}
