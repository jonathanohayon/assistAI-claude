"use client";

/**
 * The live test panel of a preview (F2): a STATIC mock with the panel's look
 * and a sample conversation. It never opens a session: it has no session
 * hook, no audio, no microphone and no request (it imports none of the live
 * panel's code). The mic button is disabled.
 */

import { useLocale, useTranslations } from "next-intl";

import { previewLiveTranscript } from "@/lib/preview-samples";

export function LiveTestPreview() {
  const tl = useTranslations("LiveTest");
  const t = useTranslations("DashboardNav");
  const locale = useLocale();
  const transcript = previewLiveTranscript(locale);
  return (
    <section
      data-live-test-preview=""
      className="relative overflow-hidden rounded-[2rem] border border-white/40 bg-white/70 p-6 shadow-[0_8px_40px_-12px_rgba(14,116,144,0.25)] backdrop-blur-xl"
    >
      <header className="mb-5 flex items-center justify-between gap-3">
        <h3 className="font-display text-xl tracking-tight text-[#18181b]">{tl("title")}</h3>
        <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#fdf2f8] px-2.5 py-1 text-[10px] font-semibold text-[#9d174d] ring-1 ring-inset ring-[#fbcfe8]">
          {t("previewBadge")}
        </span>
      </header>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            disabled
            aria-label={tl("startAria")}
            className="relative inline-flex h-24 w-24 cursor-not-allowed items-center justify-center rounded-full bg-gradient-to-br from-[#06b6d4] to-[#0e7490] text-white opacity-80 shadow-[0_12px_48px_-8px_rgba(14,116,144,0.65)]"
          >
            <svg aria-hidden viewBox="0 0 24 24" fill="none" className="h-10 w-10">
              <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <p className="max-w-[220px] text-center text-xs font-medium leading-relaxed text-[#475569]">{tl("hintIdle")}</p>
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#0e7490]">{tl("conversation")}</p>
          <ul className="flex flex-col gap-2 rounded-2xl border border-[#e2e8f0] bg-white/80 p-3">
            {transcript.map((line, i) => (
              <li key={i} className={`flex ${line.role === "user" ? "justify-end" : "justify-start"}`}>
                <span
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] leading-snug ${
                    line.role === "user" ? "bg-[#0e7490] text-white" : "border border-[#e2e8f0] bg-white text-[#18181b]"
                  }`}
                >
                  {line.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
