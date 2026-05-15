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
    <footer className="relative border-t border-white/40 bg-white/40 backdrop-blur">
      <div className="mx-auto w-full max-w-6xl px-6 py-14">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          <div className="col-span-2">
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-[#475569]">
              {t("tagline")}
            </p>
            {/* Compliance badges */}
            <div className="mt-5 flex flex-wrap gap-1.5">
              {["RGPD", "HDS", "EU"].map((badge) => (
                <span
                  key={badge}
                  className="inline-flex items-center gap-1 rounded-full bg-[#ecfeff] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#0e7490] ring-1 ring-inset ring-[#22d3ee]/30"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-2.5 w-2.5">
                    <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {badge}
                </span>
              ))}
            </div>
          </div>
          {CATEGORIES.map((cat) => (
            <div key={cat.title}>
              <p className="text-xs font-semibold uppercase tracking-widest text-[#be185d]">
                {cat.title}
              </p>
              <ul className="mt-4 space-y-2.5">
                {cat.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-sm text-[#475569] transition-colors hover:text-[#18181b]"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[#e2e8f0] pt-6 text-xs text-[#475569]">
          <p>{t("copyright", { year: new Date().getFullYear() })}</p>
          <p>
            <span className="inline-flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22d3ee] opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22d3ee]" />
              </span>
              {t("status")}
            </span>
          </p>
        </div>
      </div>
    </footer>
  );
}
