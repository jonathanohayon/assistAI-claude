"use client";

import { motion, useMotionValueEvent, useScroll } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import { Logo } from "@/components/ui/Logo";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 24));

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-[var(--color-border)]/60 bg-white/80 backdrop-blur-lg"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-8 text-sm md:flex">
          <a
            href="#industries"
            className="text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]"
          >
            Pour qui
          </a>
          <a
            href="#how"
            className="text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]"
          >
            Comment ça marche
          </a>
          <a
            href="#features"
            className="text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]"
          >
            Fonctionnalités
          </a>
          <a
            href="#pricing"
            className="text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]"
          >
            Tarifs
          </a>
          <a
            href="#demo"
            className="text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]"
          >
            Démo
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden rounded-full px-4 py-2 text-sm text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)] sm:inline-flex"
          >
            Connexion
          </Link>
          <Link
            href="#demo"
            className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white shadow-md transition-all hover:scale-[1.03] hover:shadow-lg active:scale-[0.97]"
          >
            Tester maintenant
          </Link>
        </div>
      </div>
    </motion.header>
  );
}
