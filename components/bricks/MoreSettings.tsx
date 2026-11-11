"use client";

/**
 * Shared brick primitive #2: THE disclosure of every brick — level 2
 * ("More settings") and level 3 ("Developer settings", `level={3}`) — and
 * the dashboard's "Set up your agent" block. One implementation: native
 * button + region so keyboard and screen readers get expanded/collapsed for
 * free, 44 px row, chevron, logical (RTL-safe) alignment. Uncontrolled, it is
 * collapsed on every mount (the bricks); a caller may control it (`open` /
 * `onOpenChange`, e.g. the checklist's remembered choice).
 */

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

export function MoreSettings({
  children,
  title,
  level = 2,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  summary,
  whenClosed,
  headingLevel = 3,
  className = "rounded-2xl border border-[var(--color-border)] bg-white",
}: {
  children: ReactNode;
  /** Defaults to the level's title: "More settings" (2) / "Developer settings" (3). */
  title?: ReactNode;
  /** 2 = More settings, 3 = Developer settings. Only the default title differs. */
  level?: 2 | 3;
  defaultOpen?: boolean;
  /** Controlled mode (e.g. a remembered choice); otherwise the component keeps its own state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Non-interactive content inside the toggle row, after the title (e.g. a progress bar). */
  summary?: ReactNode;
  /** Shown under the row, OUTSIDE the toggle, only while closed (e.g. the next step and its link). */
  whenClosed?: ReactNode;
  headingLevel?: 2 | 3;
  /** The container's look; the row and panel behave the same. */
  className?: string;
}) {
  const t = useTranslations("Bricks");
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = openProp ?? ownOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const panelId = useId();
  const buttonId = useId();

  return (
    <div className={className}>
      <Heading className="m-0">
        <button
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
          className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3 text-start text-sm font-semibold text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2"
        >
          <span className="min-w-0 flex-1">{title ?? (level === 3 ? t("developerSettings") : t("moreSettings"))}</span>
          {summary}
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
      </Heading>
      {!open && whenClosed}
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
