"use client";

/**
 * The dashboard's left menu (right in Hebrew: logical start side), shared by
 * the tenant dashboard and the admin tenant view (`asUserId`: URLs under
 * /admin/users/<id>, plain links since /admin has no locale).
 *
 * Two blocks (products, shared), computed on the SERVER (lib/dashboard-nav.ts
 * + lib/product-menu.ts): this component only renders them and marks the
 * active entry. A preview product may carry a small state label
 * (item.badge, lib/trial-cta.ts navBadge, the header's own decision):
 * "Bientôt", or "Essai gratuit" only where the trial is startable; it still
 * links to its page, whose own server gate decides.
 *
 * From lg: a sticky column. Below lg: a "Menu" button opening a drawer
 * (dialog, focus trapped, Esc closes, focus back on the button).
 */

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import { activeEntry, type NavBlock, type NavEntryId } from "@/lib/dashboard-nav";

const ICON_PATHS: Record<NavEntryId, ReactNode> = {
  reception: (
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
  ),
  sales: (
    <>
      <path d="M3 11l18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </>
  ),
  connect: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </>
  ),
  myAgent: (
    <>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  calls: (
    <>
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </>
  ),
  clients: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </>
  ),
  billing: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
};

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2 focus-visible:ring-offset-white";

function NavList({
  blocks,
  active,
  asUserId,
  onNavigate,
}: {
  blocks: NavBlock[];
  active: NavEntryId | null;
  asUserId?: string | null;
  onNavigate?: () => void;
}) {
  const t = useTranslations("DashboardNav");
  return (
    <div className="space-y-6">
      {blocks.map((block) => (
        <div key={block.id}>
          <p className="px-3 text-[11px] font-semibold uppercase tracking-widest text-[#64748b] rtl:tracking-normal">
            {t(block.id === "products" ? "blockProducts" : "blockShared")}
          </p>
          <ul className="mt-2 space-y-1">
            {block.items.map((item) => {
              const isActive = item.id === active;
              const className = `group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${FOCUS_RING} ${
                isActive
                  ? "bg-[#be185d] text-white shadow-sm"
                  : "text-[#334155] hover:bg-[#be185d]/[0.06] hover:text-[#9d174d]"
              }`;
              const body = (
                <>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className={`h-4 w-4 shrink-0 ${isActive ? "text-white" : "text-[#be185d]"}`}
                  >
                    {ICON_PATHS[item.id]}
                  </svg>
                  {/* The name is never truncated: when the name and its badge
                      don't fit on one line, the badge wraps UNDER the name. */}
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                    <span data-nav-label="" className="min-w-0 break-words">
                      {t(item.labelKey)}
                    </span>
                    {item.badge && (
                      <span
                        data-nav-badge=""
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          isActive
                            ? "bg-white/20 text-white"
                            : item.badge === "try"
                              ? "bg-[#be185d]/10 text-[#9d174d]"
                              : "bg-[#f1f5f9] text-[#475569]"
                        }`}
                      >
                        {t(item.badge === "try" ? "stateTry" : "stateSoon")}
                      </span>
                    )}
                  </span>
                </>
              );
              const common = {
                className,
                "aria-current": isActive ? ("page" as const) : undefined,
                onClick: onNavigate,
                "data-entry": item.id,
                "data-state": item.preview ? `preview-${item.preview}` : "owned",
              };
              return (
                <li key={item.id}>
                  {asUserId ? (
                    <NextLink href={item.href} {...common}>
                      {body}
                    </NextLink>
                  ) : (
                    <Link href={item.href} {...common}>
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function DashboardSidebar({ blocks, asUserId }: { blocks: NavBlock[]; asUserId?: string | null }) {
  const t = useTranslations("DashboardNav");
  const pathname = usePathname();
  const active = activeEntry(pathname ?? "", asUserId);
  const activeItem = blocks.flatMap((b) => b.items).find((i) => i.id === active);

  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Focus goes back to the button that opened the drawer.
    requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  // Drawer open: focus its first control, lock the page scroll.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      {/* lg and up: the column. */}
      <aside className="hidden w-60 shrink-0 lg:block">
        <nav aria-label={t("navLabel")} className="sticky top-24 pb-10 pt-6">
          <NavList blocks={blocks} active={active} asUserId={asUserId} />
        </nav>
      </aside>

      {/* Below lg: the menu button and its drawer. */}
      <div className="px-4 pt-4 sm:px-6 lg:hidden">
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls="dashboard-drawer"
          onClick={() => setOpen(true)}
          className={`inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-medium text-[#334155] shadow-xs ${FOCUS_RING}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="h-4 w-4 text-[#be185d]">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span>{t("menu")}</span>
          {activeItem && (
            <>
              <span aria-hidden="true" className="text-[#94a3b8]">·</span>
              <span className="font-semibold text-[#9d174d]">{t(activeItem.labelKey)}</span>
            </>
          )}
        </button>

        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-[#0f172a]/30" aria-hidden="true" onClick={close} />
            <div
              id="dashboard-drawer"
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={t("navLabel")}
              onKeyDown={onPanelKeyDown}
              className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-white px-3 pb-8 pt-4 shadow-2xl"
            >
              <div className="mb-4 flex items-center justify-between px-3">
                <span className="text-sm font-semibold text-[#18181b]">{t("menu")}</span>
                <button
                  type="button"
                  onClick={close}
                  aria-label={t("closeMenu")}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-[#475569] hover:bg-[#f1f5f9] ${FOCUS_RING}`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="h-4 w-4">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <nav aria-label={t("navLabel")}>
                <NavList blocks={blocks} active={active} asUserId={asUserId} onNavigate={close} />
              </nav>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
