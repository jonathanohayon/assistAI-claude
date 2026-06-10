"use client";

import { useTranslations } from "next-intl";

import { Stagger, StaggerItem } from "./Reveal";

/**
 * Bande fine de crédibilité sous le Hero : « ça se branche sur vos outils ».
 * 3 intégrations concrètes (WhatsApp, Google Calendar, Google Sheets) en une
 * rangée de ~100px — répond à l'objection « et mes outils ? » avant même
 * qu'elle se pose, sans alourdir le haut de page.
 */

const INTEGRATIONS = [
  { key: "whatsapp", icon: <WhatsAppIcon /> },
  { key: "calendar", icon: <GoogleCalendarIcon /> },
  { key: "crm", icon: <GoogleSheetsIcon /> },
] as const;

export function IntegrationsStrip() {
  const t = useTranslations("Integrations");

  return (
    <section aria-label={t("kicker")} className="relative py-10 sm:py-12">
      <div className="mx-auto w-full max-w-5xl px-6">
        <Stagger className="flex flex-col items-center gap-5">
          <StaggerItem>
            <p className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-[#0e7490]">
              {t("kicker")}
            </p>
          </StaggerItem>
          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            {INTEGRATIONS.map((item) => (
              <StaggerItem key={item.key}>
                <div className="flex items-center gap-2.5 rounded-full border border-[#fbcfe8] bg-white/80 py-2 ps-3 pe-4 shadow-sm backdrop-blur transition-colors duration-300 hover:border-[#22d3ee]/60">
                  <span aria-hidden className="h-5 w-5 shrink-0">
                    {item.icon}
                  </span>
                  <span className="text-[13px] font-medium text-[#1e2937]">
                    {t(item.key)}
                  </span>
                </div>
              </StaggerItem>
            ))}
          </div>
        </Stagger>
      </div>
    </section>
  );
}

/* ----------------------------- brand icons -------------------------------- */
/* Logos officiels simplifiés, viewBox 24, couleurs marque — pas d'emoji.     */

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
      <path
        fill="#25D366"
        d="M12 2a9.94 9.94 0 0 0-8.59 15L2 22l5.15-1.35A10 10 0 1 0 12 2Z"
      />
      <path
        fill="#fff"
        d="M16.6 13.83c-.25-.13-1.47-.72-1.7-.8-.23-.09-.39-.13-.56.12-.16.25-.64.8-.78.97-.14.16-.29.18-.54.06a6.7 6.7 0 0 1-1.96-1.21 7.35 7.35 0 0 1-1.36-1.69c-.14-.25 0-.38.11-.5.11-.12.25-.3.37-.44.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.12-.55-1.34-.76-1.83-.2-.48-.4-.42-.56-.43h-.47c-.17 0-.44.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.57.12.16 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.6.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.28Z"
      />
    </svg>
  );
}

function GoogleCalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
      <rect x="3" y="4" width="18" height="17" rx="2" fill="#fff" />
      <path d="M3 8h18v3H3z" fill="#4285F4" />
      <path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2H3V6Z" fill="#1967D2" />
      <rect
        x="3"
        y="4"
        width="18"
        height="17"
        rx="2"
        fill="none"
        stroke="#1967D2"
        strokeWidth="1.2"
      />
      <text
        x="12"
        y="17.5"
        textAnchor="middle"
        fontSize="8.5"
        fontWeight="700"
        fill="#1967D2"
        fontFamily="system-ui, sans-serif"
      >
        17
      </text>
    </svg>
  );
}

function GoogleSheetsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
      <path
        d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"
        fill="#0F9D58"
      />
      <path d="M14 2v5h5l-5-5Z" fill="#87CEAC" />
      <path
        d="M8 11h8v7H8v-7Zm1.5 1.5v1.25h2v-1.25h-2Zm3.5 0v1.25h2v-1.25h-2Zm-3.5 2.5v1.25h2V15h-2Zm3.5 0v1.25h2V15h-2Z"
        fill="#fff"
      />
    </svg>
  );
}
