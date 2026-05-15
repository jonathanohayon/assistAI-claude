"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";

/**
 * Floating WhatsApp support button (bottom-right). Renvoie vers le
 * WhatsApp de l'admin pour assistance en direct depuis la landing.
 *
 * Phone configurable via `NEXT_PUBLIC_SUPPORT_WHATSAPP` (E.164 sans `+`,
 * ex: `972585001007`). Fallback : Jonathan (+972 58 500 1007) sinon.
 *
 * UX notes :
 * - Position fixe bottom-right, z-40 (sous nav z-50 mais au-dessus du
 *   contenu). Respect safe-area-inset pour les iPhones avec gesture bar.
 * - Pulse ring subtil + halo glow vert WhatsApp.
 * - `aria-label` localisé.
 * - `prefers-reduced-motion` : pas d'animation pulse.
 */
export function SupportFab() {
  const t = useTranslations("Support");
  const reduce = useReducedMotion();

  const rawPhone =
    process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? "972585001007";
  const phone = rawPhone.replace(/[^\d]/g, "");
  const greeting = t("waGreeting");
  const href = `https://wa.me/${phone}?text=${encodeURIComponent(greeting)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("waLabel")}
      className="group fixed z-40 inline-flex items-center justify-center"
      style={{
        right: "max(1.25rem, env(safe-area-inset-right))",
        bottom: "max(1.25rem, env(safe-area-inset-bottom))",
      }}
    >
      {/* Pulse rings */}
      {!reduce && (
        <>
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full bg-[#25D366]"
            initial={{ scale: 1, opacity: 0.6 }}
            animate={{ scale: 1.5, opacity: 0 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
          />
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full bg-[#25D366]"
            initial={{ scale: 1, opacity: 0.4 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{
              duration: 2.4,
              delay: 0.8,
              repeat: Infinity,
              ease: "easeOut",
            }}
          />
        </>
      )}

      {/* Button */}
      <span
        className="relative inline-flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#25D366] to-[#128C7E] text-white shadow-2xl transition-transform group-hover:scale-110 group-active:scale-95"
        style={{ boxShadow: "0 10px 30px -4px rgba(37,211,102,0.55)" }}
      >
        {/* WhatsApp glyph officiel — simplifié, monochrome blanc */}
        <svg
          viewBox="0 0 32 32"
          fill="currentColor"
          className="h-7 w-7"
          aria-hidden
        >
          <path d="M16.001 3C9.373 3 4 8.373 4 15c0 2.378.69 4.595 1.881 6.466L4 29l7.69-2.013A11.95 11.95 0 0 0 16 27c6.628 0 12-5.373 12-12S22.629 3 16.001 3Zm0 21.6c-1.804 0-3.515-.49-4.978-1.343l-.357-.213-4.564 1.196 1.215-4.448-.232-.366A9.557 9.557 0 0 1 6.4 15c0-5.291 4.31-9.6 9.601-9.6S25.6 9.709 25.6 15c0 5.292-4.31 9.6-9.599 9.6Zm5.474-7.176c-.3-.15-1.772-.873-2.046-.972-.273-.1-.473-.15-.673.15-.2.298-.773.971-.948 1.171-.174.198-.348.224-.647.075-.299-.15-1.263-.466-2.405-1.485-.889-.793-1.49-1.773-1.663-2.071-.174-.298-.018-.46.131-.609.134-.133.299-.349.448-.523.15-.174.2-.298.299-.498.099-.198.05-.372-.025-.522-.075-.149-.673-1.621-.923-2.222-.244-.583-.492-.503-.673-.512-.174-.008-.373-.01-.572-.01-.199 0-.523.074-.797.372-.273.298-1.045 1.021-1.045 2.49 0 1.47 1.07 2.89 1.219 3.088.149.199 2.107 3.22 5.103 4.515.713.308 1.27.491 1.704.629.715.227 1.368.195 1.883.119.575-.086 1.772-.724 2.022-1.422.25-.7.25-1.3.175-1.422-.075-.124-.273-.198-.572-.348Z" />
        </svg>
      </span>
    </a>
  );
}
