"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";

import { Logo } from "@/components/ui/Logo";

export function Footer() {
  const t = useTranslations("Footer");

  const CATEGORIES = [
    {
      title: t("categories.product"),
      links: [
        { label: t("links.demo"), href: "#demo" },
        { label: t("links.features"), href: "#features" },
        { label: t("links.how"), href: "#how" },
      ],
    },
    {
      title: t("categories.account"),
      links: [
        { label: t("links.login"), href: "/login" },
        { label: t("links.dashboard"), href: "/dashboard" },
      ],
    },
    {
      title: t("categories.industries"),
      links: [
        { label: t("links.medical"), href: "#industries" },
        { label: t("links.beauty"), href: "#industries" },
        { label: t("links.barbers"), href: "#industries" },
      ],
    },
  ];

  return (
    <footer className="border-t border-[var(--color-border)]/60 bg-white/40">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          <div className="col-span-2">
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-[var(--color-muted-foreground)]">
              {t("tagline")}
            </p>
          </div>
          {CATEGORIES.map((cat) => (
            <div key={cat.title}>
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
                {cat.title}
              </p>
              <ul className="mt-4 space-y-2.5">
                {cat.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-sm text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-border)]/60 pt-6 text-xs text-[var(--color-muted-foreground)]">
          <p>{t("copyright", { year: new Date().getFullYear() })}</p>
          <p>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
              {t("status")}
            </span>
          </p>
        </div>
      </div>
    </footer>
  );
}
