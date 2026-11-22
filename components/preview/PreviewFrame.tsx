"use client";

/**
 * The frame of a product preview (F2): a card holding the real screen, with
 * a bar ON TOP of it: a small "Aperçu" label and one line saying the data is
 * a sample and nothing is saved. The bar belongs to the card, well below the
 * page header (F3 push): sitting right under the header's "C'est noté, nous
 * vous préviendrons." it read as a contradiction.
 * The frame is a named region (its label) described by that line, so a
 * keyboard or screen-reader user hears it is a preview before any control.
 */

import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";

export function PreviewFrame({ children }: { children: ReactNode }) {
  const t = useTranslations("DashboardNav");
  const id = useId();
  return (
    <section aria-labelledby={`${id}-label`} aria-describedby={`${id}-note`} data-preview-frame="" className="relative mt-12 sm:mt-14">
      <div
        data-preview-card=""
        className="overflow-hidden rounded-[1.75rem] border border-[#fbcfe8] bg-white/50 shadow-[0_8px_30px_-18px_rgba(190,24,93,0.35)]"
      >
        <div data-preview-bar="" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[#fbcfe8] bg-[#fdf2f8] px-4 py-2.5 sm:px-6">
          <span
            id={`${id}-label`}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#9d174d] ring-1 ring-inset ring-[#fbcfe8]"
          >
            <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {t("previewBadge")}
          </span>
          <p id={`${id}-note`} className="text-xs text-[#475569]">
            {t("previewNote")}
          </p>
        </div>
        <div className="p-4 sm:p-6">{children}</div>
      </div>
    </section>
  );
}
