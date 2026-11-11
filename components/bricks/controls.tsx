"use client";

/**
 * Controls shared by the bricks (Voice, Persona…): radio chips, segmented
 * filter, labelled switch, and the WAI-ARIA radio keyboard pattern.
 * Extracted when the second brick arrived (no generic framework up front).
 */

import { useId, type KeyboardEvent, type ReactNode } from "react";

import { radioKeyTarget } from "./voice/voice-ui";

// Brand: magenta → rose for "selected", cyan focus ring (never pink → cyan).
export const SELECTED =
  "border-transparent bg-gradient-to-br from-[#be185d] to-[#db2777] text-white shadow-md ring-2 ring-[#67e8f9] ring-offset-1";
export const FOCUS = "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2";
export const LABEL = "text-sm font-semibold text-[#18181b]";
export const HINT = "mt-0.5 text-xs leading-relaxed text-[#475569]";

/** Arrow-key handler for a radiogroup of buttons (roving tabindex). */
export function radioKeys(ids: readonly string[], current: string, onPick: (id: string) => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const target = radioKeyTarget(e.key, ids, current, rtl);
    if (target === null) return;
    e.preventDefault();
    onPick(target);
    const group = e.currentTarget;
    requestAnimationFrame(() =>
      group.querySelector<HTMLElement>(`[role="radio"][data-id="${CSS.escape(target)}"]`)?.focus(),
    );
  };
}

export function Segmented({
  label,
  options,
  selected,
  onPick,
}: {
  label: string;
  /** `accent`: optional text-colour class for that option (e.g. a gender colour), with a dot. */
  options: Array<{ id: string; label: string; accent?: { text: string; dot: string } }>;
  selected: string;
  onPick: (id: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={radioKeys(options.map((o) => o.id), selected, onPick)}
      className="inline-flex rounded-xl bg-[#f1f5f9] p-1"
    >
      {options.map((o) => {
        const active = o.id === selected;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            data-id={o.id}
            tabIndex={active ? 0 : -1}
            onClick={() => onPick(o.id)}
            className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${FOCUS} ${
              active ? "bg-white shadow-sm" : "hover:bg-white/60"
            } ${o.accent ? o.accent.text : active ? "text-[#18181b]" : "text-[#475569] hover:text-[#18181b]"}`}
          >
            {o.accent && <span aria-hidden className={`h-2 w-2 rounded-full ${o.accent.dot}`} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ChipGroup({
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
      <div
        role="radiogroup"
        aria-labelledby={id}
        onKeyDown={radioKeys(options.map((o) => o.id), selected, onPick)}
        className="mt-2 flex flex-wrap gap-2"
      >
        {options.map((o) => {
          const active = o.id === selected;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              data-id={o.id}
              tabIndex={active ? 0 : -1}
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

export function ToggleRow({
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
