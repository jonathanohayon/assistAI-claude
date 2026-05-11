"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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

  const drawerRef = useRef<HTMLElement | null>(null);
  const burgerRef = useRef<HTMLButtonElement | null>(null);

  // Pas de scroll-lock — le user veut pouvoir scroller la page derrière.
  // Écoute Escape pour fermer + click hors du drawer (mais pas sur le
  // bouton burger qui a son propre toggle).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (drawerRef.current?.contains(target)) return;
      if (burgerRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <>
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
            ref={burgerRef}
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

    </motion.header>

    {/* Drawer mobile : fin, transparent (blur), pas de backdrop dim →
        l'utilisateur peut scroller la page derrière. Click hors drawer
        géré par le pointerdown listener (useEffect). Pas de scroll-lock. */}
    <AnimatePresence>
      {open && (
        <motion.aside
          ref={drawerRef as React.RefObject<HTMLElement>}
          key="drawer"
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          role="dialog"
          aria-modal="false"
          aria-label="Menu"
          className="fixed right-0 top-[64px] bottom-0 z-50 w-[60vw] max-w-[220px] overflow-y-auto border-l border-[var(--color-border)]/40 bg-white/55 backdrop-blur-xl shadow-xl md:hidden"
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
      )}
    </AnimatePresence>
    </>
  );
}
