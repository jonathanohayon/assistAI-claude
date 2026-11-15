"use client";

import { useTranslations } from "next-intl";

import type { TalkCopy } from "@/lib/marketing/home-content";

import { Reveal } from "../Reveal";
import { supportHref } from "../SupportFab";

/**
 * "Let's talk": where the home has its pricing grid. No price on a landing
 * page; the button opens the same support conversation as the floating
 * support button (supportHref, the only place the number lives).
 */
export function TalkToUs({ kicker, title, subtitle, button }: TalkCopy) {
  const t = useTranslations("Support");
  return (
    <section id="talk" aria-labelledby="talk-title" className="relative px-6 py-20 sm:py-28">
      <Reveal className="mx-auto w-full max-w-4xl">
        <div className="relative overflow-hidden rounded-[2rem] border border-[#22d3ee]/30 bg-white px-6 py-12 text-center shadow-[0_24px_80px_-32px_rgba(190,24,93,0.35)] sm:px-14 sm:py-16">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0e7490]">{kicker}</p>
          <h2 id="talk-title" className="mt-3 font-display text-4xl tracking-tight text-[#be185d] sm:text-5xl">
            {title}
          </h2>
          {subtitle ? (
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-[#475569] sm:text-lg">{subtitle}</p>
          ) : null}
          <a
            href={supportHref(t("waGreeting"))}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-9 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[#be185d] to-[#db2777] px-7 py-3.5 text-base font-semibold text-white shadow-[0_8px_28px_-8px_rgba(190,24,93,0.5)] ring-2 ring-[#22d3ee]/40 transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden>
              <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.9A8 8 0 1 1 21 12Z" strokeLinejoin="round" />
            </svg>
            {button}
          </a>
        </div>
      </Reveal>
    </section>
  );
}
