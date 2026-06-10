"use client";

/**
 * Modal d'édition d'un soin : nom, durée (minutes), prix (₪), description
 * et sélection des centres (sentinel "all" = tous les centres, sinon
 * checkboxes par centre). Suppression avec window.confirm, fermeture ESC.
 *
 * Utilisé par : services-section.tsx (clic sur un soin ou "Éditer").
 */

import { useEffect, useRef } from "react";

import { formatDuration, formatPriceILS } from "./formatting";
import type { BusinessCentre, BusinessService, Translator } from "./types";

export function ServiceEditModal({
  service,
  centres,
  onPatch,
  onDelete,
  onClose,
  t,
}: {
  service: BusinessService;
  centres: BusinessCentre[];
  onPatch: (partial: Partial<BusinessService>) => void;
  onDelete: () => void;
  onClose: () => void;
  t: Translator;
}) {
  const firstInputRef = useRef<HTMLInputElement>(null);
  const titleId = `service-modal-title-${service.id}`;

  useEffect(() => {
    firstInputRef.current?.focus();
    firstInputRef.current?.select();
  }, []);

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

  const isAll = service.centreIds === "all";
  const selectedIds = isAll ? [] : (service.centreIds as string[]);

  const toggleCentre = (id: string) => {
    if (isAll) {
      // Coming from "all" → start with just this one selected
      onPatch({ centreIds: [id] });
      return;
    }
    const next = selectedIds.includes(id)
      ? selectedIds.filter((c) => c !== id)
      : [...selectedIds, id];
    onPatch({ centreIds: next });
  };

  const toggleAll = () => {
    if (isAll) {
      onPatch({ centreIds: [] });
    } else {
      onPatch({ centreIds: "all" });
    }
  };

  const canSave = service.name.trim().length > 0;

  return (
    <div
      className="overlay-anim fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal-anim flex max-h-[92vh] w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:w-full"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[#e2e8f0] px-5 py-4">
          <div className="min-w-0">
            <h3
              id={titleId}
              className="text-base font-extrabold tracking-tight text-[#18181b]"
            >
              {service.name
                ? t("businessModalServiceTitleEdit", { name: service.name })
                : t("businessModalServiceTitleNew")}
            </h3>
            <p className="text-[11px] text-[#94a3b8]">
              {t("businessModalSubtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("businessModalCloseAria")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#475569] transition-all hover:bg-[#fee2e2] hover:text-[#dc2626] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-4 w-4">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#78350f]">
              {t("businessModalNameLabel")}
            </label>
            <input
              ref={firstInputRef}
              type="text"
              value={service.name}
              onChange={(e) => onPatch({ name: e.target.value })}
              placeholder={t("businessModalNamePlaceholder")}
              className="w-full min-h-[44px] rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors placeholder:text-[#cbd5e1] focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#78350f]">
                {t("businessModalDurationLabel")}
              </label>
              <input
                type="number"
                value={service.durationMinutes}
                step={5}
                min={5}
                max={480}
                onChange={(e) =>
                  onPatch({ durationMinutes: Number(e.target.value) })
                }
                className="w-full min-h-[44px] rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm font-mono text-[#18181b] shadow-xs transition-colors focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
              />
              <p className="mt-1 text-[10px] text-[#94a3b8]">
                {formatDuration(service.durationMinutes)}
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#78350f]">
                {t("businessModalPriceLabel")}
              </label>
              <input
                type="number"
                value={service.priceILS}
                step={10}
                min={0}
                max={100000}
                onChange={(e) =>
                  onPatch({ priceILS: Number(e.target.value) })
                }
                className="w-full min-h-[44px] rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm font-mono text-[#18181b] shadow-xs transition-colors focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
              />
              <p className="mt-1 text-[10px] text-[#94a3b8]">
                {formatPriceILS(service.priceILS)}
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#78350f]">
              {t("businessModalDescriptionLabel")}
            </label>
            <textarea
              value={service.description}
              rows={3}
              onChange={(e) => onPatch({ description: e.target.value })}
              placeholder={t("businessModalDescriptionPlaceholder")}
              className="w-full resize-y rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors placeholder:text-[#cbd5e1] focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#78350f]">
              {t("businessModalCentresLabel")}
            </label>
            <div className="space-y-1.5">
              <button
                type="button"
                role="checkbox"
                aria-checked={isAll}
                onClick={toggleAll}
                className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  isAll
                    ? "border-[#10b981] bg-gradient-to-br from-[#ecfdf5] to-white"
                    : "border-[#e2e8f0] bg-white hover:border-[#10b981]/40"
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                    isAll
                      ? "border-[#10b981] bg-[#10b981]"
                      : "border-[#cbd5e1] bg-white"
                  }`}
                >
                  {isAll && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" className="h-3 w-3 text-white">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                <span className="text-sm font-semibold text-[#18181b]">
                  {t("businessModalCentresAll")}
                </span>
                <span className="ml-auto text-[10px] text-[#94a3b8]">
                  {t("businessModalCentresSentinel")}
                </span>
              </button>

              {centres.length === 0 && (
                <p className="rounded-lg bg-[#fffbeb]/60 px-3 py-2 text-[11px] text-[#92400e]">
                  {t("businessModalCentresNoneHint")}
                </p>
              )}

              {!isAll &&
                centres.map((c) => {
                  const checked = selectedIds.includes(c.id);
                  return (
                    <button
                      type="button"
                      key={c.id}
                      role="checkbox"
                      aria-checked={checked}
                      onClick={() => toggleCentre(c.id)}
                      className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        checked
                          ? "border-[#f59e0b] bg-[#fffbeb]"
                          : "border-[#e2e8f0] bg-white hover:border-[#f59e0b]/40"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                          checked
                            ? "border-[#f59e0b] bg-[#f59e0b]"
                            : "border-[#cbd5e1] bg-white"
                        }`}
                      >
                        {checked && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" className="h-3 w-3 text-white">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[#18181b]">
                          {c.name || t("businessServicesCentreNoName")}
                        </span>
                        {c.address && (
                          <span className="block truncate text-[10px] text-[#94a3b8]">
                            {c.address}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-[#e2e8f0] bg-white px-5 py-4">
          <button
            type="button"
            onClick={() => {
              if (
                typeof window !== "undefined" &&
                !window.confirm(
                  t("businessModalDeleteConfirm", {
                    name: service.name || t("businessModalDeleteFallback"),
                  }),
                )
              )
                return;
              onDelete();
              onClose();
            }}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            {t("businessModalDelete")}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] transition-colors hover:bg-[#f8fafc]"
            >
              {t("businessModalCancel")}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={!canSave}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#f59e0b] to-[#b45309] px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {t("businessModalSave")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
