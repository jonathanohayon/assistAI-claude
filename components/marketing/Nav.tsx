"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Logo } from "@/components/ui/Logo";

import { LocaleSwitcher } from "./LocaleSwitcher";

const NAV_LINKS = [
  { href: "#industries", labelKey: "industries" },
  { href: "#how", labelKey: "how" },
  { href: "#features", labelKey: "features" },
  { href: "#pricing", labelKey: "pricing" },
  { href: "#demo", labelKey: "demo" },
] as const;

export function Nav() {
  const t = useTranslations("Nav");
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 24));

  // Bloque le scroll du body quand le menu mobile est ouvert (évite le
  // "bleed-through" du contenu derrière l'overlay). Écoute aussi Escape
  // pour fermer (accessibilité standard pour dialog/drawer).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled || open
          ? "border-b border-[var(--color-border)]/60 bg-white/80 backdrop-blur-lg"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-8 text-sm md:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]"
            >
              {t(`links.${l.labelKey}`)}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <Link
            href="/login"
            className="hidden rounded-full px-4 py-2 text-sm text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)] sm:inline-flex"
          >
            {t("login")}
          </Link>
          <Link
            href="#demo"
            className="hidden items-center gap-1.5 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white shadow-md transition-all hover:scale-[1.03] hover:shadow-lg active:scale-[0.97] md:inline-flex"
          >
            {t("ctaTry")}
          </Link>

          {/* Burger button — mobile only */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={open}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)] md:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              {open ? (
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : (
                <path
                  d="M4 7h16M4 12h16M4 17h16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile side-drawer with translucent backdrop */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop : opacity transition + click handler ferme le menu.
                Pointer-events transparent dès que open=false grâce à
                AnimatePresence qui retire le node. */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              onClick={() => setOpen(false)}
              aria-hidden
              className="fixed inset-0 top-[64px] z-40 bg-[var(--color-foreground)]/30 backdrop-blur-[2px] md:hidden"
            />
            {/* Drawer : slide depuis la droite. width 80vw max 320px pour
                garder un peu de contenu visible derrière (UX standard). */}
            <motion.aside
              key="drawer"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              className="fixed right-0 top-[64px] bottom-0 z-50 w-[80vw] max-w-[320px] overflow-y-auto border-l border-[var(--color-border)]/60 bg-white/95 backdrop-blur-lg shadow-2xl md:hidden"
            >
              <nav className="flex flex-col gap-1 px-5 py-5 text-sm">
                {NAV_LINKS.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="rounded-xl px-3 py-3 text-base text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)]"
                  >
                    {t(`links.${l.labelKey}`)}
                  </a>
                ))}
                <div className="mt-2 flex flex-col gap-2 border-t border-[var(--color-border)]/60 pt-3">
                  <Link
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="rounded-xl px-3 py-3 text-base text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                  >
                    {t("login")}
                  </Link>
                  <Link
                    href="#demo"
                    onClick={() => setOpen(false)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-3 text-base font-medium text-white shadow-md"
                  >
                    {t("ctaTry")}
                  </Link>
                </div>
              </nav>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
