"use client";

/**
 * Shared brick primitive #2: THE disclosure of every brick — level 2
 * ("More settings") and level 3 ("Developer settings", `level={3}`). One
 * implementation: collapsed on every mount (no remembered state), native
 * button + region so keyboard and screen readers get expanded/collapsed for
 * free, 44 px row, chevron, logical (RTL-safe) alignment.
 */

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

export function MoreSettings({
  children,
  title,
  level = 2,
  defaultOpen = false,
}: {
  children: ReactNode;
  /** Defaults to the level's title: "More settings" (2) / "Developer settings" (3). */
  title?: string;
  /** 2 = More settings, 3 = Developer settings. Only the default title differs. */
  level?: 2 | 3;
  defaultOpen?: boolean;
}) {
  const t = useTranslations("Bricks");
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const buttonId = useId();

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-white">
      <h3 className="m-0">
        <button
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3 text-start text-sm font-semibold text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2"
        >
          {title ?? (level === 3 ? t("developerSettings") : t("moreSettings"))}
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-4 w-4 shrink-0 text-[var(--color-muted-foreground)] transition-transform duration-200 motion-reduce:transition-none ${
              open ? "rotate-180" : ""
            }`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        hidden={!open}
        className="space-y-5 border-t border-[var(--color-border)] px-4 py-4"
      >
        {children}
      </div>
    </div>
  );
}
