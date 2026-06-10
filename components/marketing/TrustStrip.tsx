"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Reveal, Stagger, StaggerItem } from "./Reveal";

/**
 * Bande de confiance compacte (~120-160px desktop) — remplace l'ancienne
 * section Security : kicker centré + rangée des 6 badges (titre seul).
 */

type BadgeKey = "rgpd" | "hds" | "e2e" | "audit" | "eu" | "soc2";

const ICONS: Record<BadgeKey, ReactNode> = {
  rgpd: (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
      <path
        d="M12 3 4 6v6c0 4.5 3.4 8.4 8 9 4.6-.6 8-4.5 8-9V6l-8-3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="m9 12 2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  hds: (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M12 8v8M8 12h8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  e2e: (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
      <rect
        x="4"
        y="10"
        width="16"
        height="11"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M8 10V7a4 4 0 0 1 8 0v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="15" r="1.3" fill="currentColor" />
    </svg>
  ),
  audit: (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
      <path
        d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M14 3v5h5M8 13h8M8 17h5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  eu: (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  soc2: (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
      <path
        d="M12 2 4 5v7c0 4 3.4 7.6 8 10 4.6-2.4 8-6 8-10V5l-8-3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="m9 12 2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

const BADGE_KEYS: BadgeKey[] = ["rgpd", "hds", "e2e", "audit", "eu", "soc2"];

export function TrustStrip() {
  const t = useTranslations("Security");

  return (
    <section id="security" className="relative bg-[#faf7f2] py-12 sm:py-14">
      <div className="mx-auto w-full max-w-6xl px-6">
        <Reveal className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0e7490]">
            {t("kicker")}
          </p>
        </Reveal>

        <Stagger className="mt-6 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          {BADGE_KEYS.map((key) => (
            <StaggerItem key={key}>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#18181b] shadow-sm backdrop-blur transition-shadow hover:shadow-md">
                <span className="text-[#0e7490]" aria-hidden>
                  {ICONS[key]}
                </span>
                {t(`badges.${key}.title`)}
              </span>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
