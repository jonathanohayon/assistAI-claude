"use client";

/**
 * "Captured from the conversation" block of one campaign call (results
 * modal). Renders NOTHING when capture is off (see lib/campaigns/captured-items.ts).
 * Labels come from the campaign's current schema; values are rendered as
 * React text (escaped), wrap when long, and are bidi-isolated so a Hebrew
 * value in a French UI (or the reverse) reads correctly.
 */

import { useTranslations } from "next-intl";

import type { CapturedView } from "@/lib/campaigns/capture";
import type { ExtractionField } from "@/lib/campaigns/constants";
import { capturedItems, type CapturedValue } from "@/lib/campaigns/captured-items";

export function CapturedFromConversation({
  schema,
  captured,
  captureOn,
}: {
  schema: readonly ExtractionField[] | null | undefined;
  captured: CapturedView | undefined;
  captureOn: boolean;
}) {
  const t = useTranslations("DashboardCampaigns");
  const items = capturedItems(schema, captured, captureOn);
  if (!items) return null;

  const show = (v: CapturedValue) =>
    typeof v === "boolean" ? t(v ? "capturedYes" : "capturedNo") : String(v);

  return (
    <section className="mb-3 rounded-xl border border-[#ede9fe] bg-[#faf5ff] px-3.5 py-3">
      <h5 className="flex items-center gap-1.5 text-[12px] font-bold text-[#5b21b6]">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.6A8 8 0 1 1 21 12Z" />
          <path d="M8.5 12h7M8.5 9h4" />
        </svg>
        {t("capturedTitle")}
      </h5>
      <p className="mt-0.5 text-[12px] leading-snug text-[#64748b]">{t("capturedHint")}</p>
      <dl className="mt-2 divide-y divide-[#ede9fe]">
        {items.map((it) => (
          <div
            key={it.key}
            className="grid grid-cols-1 gap-0.5 py-2 first:pt-1 last:pb-0 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-4"
          >
            <dt className="min-w-0 break-words text-[12px] font-semibold text-[#475569] [overflow-wrap:anywhere]">
              <bdi>{it.label}</bdi>
            </dt>
            {it.value === null ? (
              <dd className="flex min-w-0 items-center gap-1.5 text-[13px] italic text-[#64748b]">
                <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-dashed border-[#94a3b8]" />
                {t("capturedMissing")}
              </dd>
            ) : (
              <dd className="min-w-0 whitespace-pre-line break-words text-[14px] font-medium leading-relaxed text-[#18181b] [overflow-wrap:anywhere]">
                <bdi>{show(it.value)}</bdi>
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}
