"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Link } from "@/i18n/navigation";

interface UserMenuProps {
  email: string;
  /** Initiales affichées dans l'avatar — fallback de displayName ou email */
  initials: string;
  /** Server action passée en prop pour le logout (signature form action) */
  logoutAction: () => Promise<void>;
}

/**
 * Dropdown menu type "compte utilisateur" qui s'ouvre depuis l'avatar
 * dans le header. UX standard SaaS : avatar click → menu avec email,
 * Settings, Logout. Click outside ferme. Escape ferme.
 *
 * Logout reste un form action server-side (NextAuth signOut + redirect).
 */
export function UserMenu({ email, initials, logoutAction }: UserMenuProps) {
  const t = useTranslations("Dashboard");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("userMenuAria")}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-xs font-semibold text-white shadow-sm transition-transform hover:scale-105 ${
          open ? "ring-2 ring-[var(--color-primary)]/30 ring-offset-2" : ""
        }`}
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 origin-top-right rounded-xl border border-[var(--color-border)] bg-white p-1.5 shadow-xl ring-1 ring-black/5"
        >
          <div className="px-3 py-2.5 border-b border-[var(--color-border)]/60">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              {t("loggedInAs")}
            </p>
            <p className="mt-0.5 truncate text-sm font-medium text-[var(--color-foreground)]">
              {email}
            </p>
          </div>

          <div className="py-1">
            <Link
              href="/dashboard/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-[var(--color-muted-foreground)]">
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {t("settingsLink")}
            </Link>
          </div>

          <div className="border-t border-[var(--color-border)]/60 py-1">
            <form action={logoutAction}>
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-[var(--color-destructive)] hover:bg-red-50"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                  <path
                    d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {t("logoutButton")}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
