"use client";

// ADMIN-ONLY: one "Moteur imposé" line (engine + model selects, cost, the
// one "why" line for disabled options, the language warning, inline 400
// errors). Presentational: the caller owns the state. Shared by the
// catalogue screen and the tenant banner; never imported by a tenant page.

import { useId } from "react";

import type { RealtimeProvider } from "@/lib/realtime-provider";

import {
  ENGINE_LABEL,
  ENGINES,
  NONE_LABEL,
  NOT_HONOURED_LINE,
  costLabel,
  disabledChoices,
  engineSelectable,
  modelLabel,
  modelsOf,
  pickEngine,
  pickModel,
  type EngineOption,
  type EngineOverride,
  type FieldSlot,
} from "./engine-ui";

const SELECT =
  "min-h-9 rounded-lg border border-[var(--color-border)] bg-white px-2 py-1 text-sm text-[var(--color-foreground)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 disabled:cursor-not-allowed disabled:bg-[var(--color-muted)]";

export function EngineChoiceRow({
  label,
  options,
  choice,
  onChange,
  costPerMinUsd,
  warning,
  errors = {},
  noneLabel = NONE_LABEL,
  note,
}: {
  label: string;
  options: readonly EngineOption[];
  choice: EngineOverride | null;
  onChange: (c: EngineOverride | null) => void;
  /** The rate card's figure for the selection (null = none; no selection = not shown). */
  costPerMinUsd: number | null;
  warning: string | null;
  errors?: Partial<Record<FieldSlot, string>>;
  noneLabel?: string;
  note?: string | null;
}) {
  const id = useId();
  const disabled = disabledChoices(options, choice?.engine ?? null);
  const models = choice ? modelsOf(options, choice.engine) : [];
  return (
    <div data-engine-row={label} className="py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <p className="w-44 shrink-0 pt-1.5 text-sm font-medium text-[var(--color-foreground)]">{label}</p>
        <div>
          <label htmlFor={`${id}-e`} className="sr-only">
            {label} : moteur
          </label>
          <select
            id={`${id}-e`}
            data-field="engine"
            value={choice?.engine ?? ""}
            onChange={(e) => onChange(pickEngine(options, e.target.value as RealtimeProvider | ""))}
            aria-invalid={errors.engine ? true : undefined}
            className={SELECT}
          >
            <option value="">{noneLabel}</option>
            {ENGINES.filter((e) => options.some((o) => o.engine === e)).map((e) => (
              <option key={e} value={e} disabled={!engineSelectable(options, e)}>
                {ENGINE_LABEL[e]}
              </option>
            ))}
          </select>
          {errors.engine && (
            <p role="alert" className="mt-1 text-xs text-red-600">
              {errors.engine}
            </p>
          )}
        </div>
        {choice && (
          <div>
            <label htmlFor={`${id}-m`} className="sr-only">
              {label} : modèle
            </label>
            <select
              id={`${id}-m`}
              data-field="model"
              value={choice.model ?? ""}
              onChange={(e) => {
                const next = pickModel(options, choice.engine, e.target.value === "" ? null : e.target.value);
                if (next) onChange(next);
              }}
              aria-invalid={errors.model ? true : undefined}
              className={SELECT}
            >
              {models.map((o) => (
                <option key={o.model ?? ""} value={o.model ?? ""} disabled={!o.honoured}>
                  {modelLabel(o.model)}
                </option>
              ))}
            </select>
            {errors.model && (
              <p role="alert" className="mt-1 text-xs text-red-600">
                {errors.model}
              </p>
            )}
          </div>
        )}
        {choice && (
          <p data-cost className="pt-1.5 text-xs text-[var(--color-muted-foreground)]">
            {costLabel(costPerMinUsd)}
          </p>
        )}
      </div>
      <div className="mt-1 space-y-1 sm:pl-[11.75rem]">
        {disabled.length > 0 && (
          <p data-not-honoured className="text-xs text-[var(--color-muted-foreground)]">
            Grisé ({disabled.join(", ")}) : {NOT_HONOURED_LINE}
          </p>
        )}
        {note && <p className="text-xs text-[var(--color-muted-foreground)]">{note}</p>}
        {warning && (
          <p role="note" data-language-warning className="text-xs font-semibold text-[#b45309]">
            {warning}
          </p>
        )}
        {errors.line && (
          <p role="alert" className="text-xs text-red-600">
            {errors.line}
          </p>
        )}
      </div>
    </div>
  );
}
