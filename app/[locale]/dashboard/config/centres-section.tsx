"use client";

/**
 * Location editor (Knowledge brick): CentreEditDrawer, a dialog with the
 * name, address and the weekly hours grid (WeeklyHoursGrid: open/closed
 * toggle, times, "apply to the other days").
 *
 * Used by: components/bricks/knowledge/SheetCard.tsx.
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { isHoursValid, weekdayLabel } from "./formatting";
import {
  WEEKDAY_ORDER,
  type BusinessCentre,
  type DayHours,
  type Translator,
  type WeekDay,
  type WeeklyHours,
} from "./types";

export function CentreEditDrawer({
  centre,
  onPatch,
  onDelete,
  onClose,
  t,
}: {
  centre: BusinessCentre;
  onPatch: (partial: Partial<BusinessCentre>) => void;
  onDelete: () => void;
  onClose: () => void;
  t: Translator;
}) {
  const firstInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = `centre-drawer-title-${centre.id}`;

  // Focus first input on mount.
  useEffect(() => {
    firstInputRef.current?.focus();
    firstInputRef.current?.select();
  }, []);

  // ESC closes.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const patchHours = (day: WeekDay, partial: Partial<DayHours>) => {
    onPatch({
      hours: { ...centre.hours, [day]: { ...centre.hours[day], ...partial } },
    });
  };

  const applyToOpenDays = (sourceDay: WeekDay) => {
    const src = centre.hours[sourceDay];
    if (!src.open) return;
    const next: WeeklyHours = { ...centre.hours };
    for (const d of WEEKDAY_ORDER) {
      if (d === sourceDay) continue;
      if (next[d].open) {
        next[d] = { ...next[d], openTime: src.openTime, closeTime: src.closeTime };
      }
    }
    onPatch({ hours: next });
  };

  // Portal: the settings panel has a transform and backdrop-filter, which
  // trap a `fixed` overlay inside it (below the header and the save dock).
  return createPortal(
    <div
      className="overlay-anim fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="drawer-anim fixed right-0 top-0 flex h-full w-full max-w-[520px] flex-col overflow-y-auto bg-white shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#e2e8f0] bg-white/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <h3
              id={titleId}
              className="text-base font-extrabold tracking-tight text-[#18181b]"
            >
              {centre.name
                ? t("businessDrawerTitleEdit", { name: centre.name })
                : t("businessDrawerTitleNew")}
            </h3>
            <p className="text-[11px] text-[#94a3b8]">
              {t("businessDrawerSubtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("businessDrawerCloseAria")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[#475569] transition-all hover:bg-[#fee2e2] hover:text-[#dc2626] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-4 w-4">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 space-y-6 px-5 py-5">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#78350f]">
                {t("businessDrawerNameLabel")}
              </label>
              <input
                ref={firstInputRef}
                type="text"
                value={centre.name}
                onChange={(e) => onPatch({ name: e.target.value })}
                placeholder={t("businessDrawerNamePlaceholder")}
                className="w-full min-h-[44px] rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors placeholder:text-[#cbd5e1] focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#78350f]">
                {t("businessDrawerAddressLabel")}
              </label>
              <input
                type="text"
                value={centre.address}
                onChange={(e) => onPatch({ address: e.target.value })}
                placeholder={t("businessDrawerAddressPlaceholder")}
                className="w-full min-h-[44px] rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors placeholder:text-[#cbd5e1] focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
              />
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-extrabold tracking-tight text-[#18181b]">
                {t("businessDrawerHoursTitle")}
              </h4>
              <p className="text-[10px] text-[#94a3b8]">
                {t("businessDrawerHoursHint")}
              </p>
            </div>
            <WeeklyHoursGrid
              hours={centre.hours}
              onPatch={patchHours}
              onApplyToOthers={applyToOpenDays}
              t={t}
            />
          </div>
        </div>

        <footer className="sticky bottom-0 z-10 border-t border-[#e2e8f0] bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#b45309] to-[#b45309] px-4 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {t("businessDrawerDone")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  typeof window !== "undefined" &&
                  !window.confirm(
                    t("businessDrawerDeleteConfirm", {
                      name: centre.name || t("businessDrawerDeleteFallback"),
                    }),
                  )
                ) {
                  return;
                }
                onDelete();
                onClose();
              }}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </svg>
              {t("businessDrawerDelete")}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

// ─── WeeklyHoursGrid ─────────────────────────────────────────────────────

function WeeklyHoursGrid({
  hours,
  onPatch,
  onApplyToOthers,
  t,
}: {
  hours: WeeklyHours;
  onPatch: (day: WeekDay, partial: Partial<DayHours>) => void;
  onApplyToOthers: (sourceDay: WeekDay) => void;
  t: Translator;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {WEEKDAY_ORDER.map((d) => {
        const day = hours[d];
        const valid = isHoursValid(day);
        const labels = weekdayLabel(t, d);
        return (
          <div
            key={d}
            className={`flex flex-col gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
              day.open
                ? "border-[#e2e8f0] bg-white"
                : "border-[#f1f5f9] bg-[#f8fafc]"
            } ${!valid ? "border-[#dc2626] bg-[#fef2f2]" : ""}`}
          >
            <div className="flex items-center gap-2.5">
              <span className="w-9 shrink-0 text-[11px] font-bold uppercase tracking-wider text-[#475569]">
                {labels.short}
              </span>

              <button
                type="button"
                role="switch"
                aria-checked={day.open}
                aria-label={`${labels.long} ${day.open ? t("businessHoursOpen") : t("businessHoursClosed")}`}
                onClick={() => onPatch(d, { open: !day.open })}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f59e0b] focus-visible:ring-offset-2 ${
                  day.open
                    ? "bg-gradient-to-r from-[#10b981] to-[#059669] shadow-[0_0_12px_-2px_rgba(16,185,129,0.5)]"
                    : "bg-[#cbd5e1] hover:bg-[#94a3b8]"
                }`}
              >
                <span
                  aria-hidden
                  className="block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{
                    transform: day.open ? "translateX(20px)" : "translateX(0)",
                  }}
                />
              </button>

              <input
                type="time"
                value={day.openTime}
                onChange={(e) => onPatch(d, { openTime: e.target.value })}
                disabled={!day.open}
                aria-label={t("businessHoursOpenTimeAria", { day: labels.long })}
                className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-[#e2e8f0] bg-white px-2 py-1.5 text-xs font-mono text-[#18181b] shadow-xs transition-colors focus:border-[#f59e0b] focus:outline-none focus:ring-2 focus:ring-[#f59e0b]/30 disabled:cursor-not-allowed disabled:bg-[#f1f5f9] disabled:opacity-50"
              />
              <span className="text-[11px] text-[#94a3b8]">→</span>
              <input
                type="time"
                value={day.closeTime}
                onChange={(e) => onPatch(d, { closeTime: e.target.value })}
                disabled={!day.open}
                aria-label={t("businessHoursCloseTimeAria", { day: labels.long })}
                className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-[#e2e8f0] bg-white px-2 py-1.5 text-xs font-mono text-[#18181b] shadow-xs transition-colors focus:border-[#f59e0b] focus:outline-none focus:ring-2 focus:ring-[#f59e0b]/30 disabled:cursor-not-allowed disabled:bg-[#f1f5f9] disabled:opacity-50"
              />

              <button
                type="button"
                onClick={() => onApplyToOthers(d)}
                disabled={!day.open}
                title={t("businessHoursApplyToOthersTitle")}
                aria-label={t("businessHoursApplyToOthersAria", { day: labels.long })}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#e2e8f0] bg-white text-[#0e7490] transition-colors hover:border-[#0e7490] hover:bg-[#ecfeff] disabled:cursor-not-allowed disabled:opacity-30"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </div>
            {!valid && (
              <p className="pl-11 text-[10px] font-medium text-[#dc2626]">
                {t("businessHoursInconsistent")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
