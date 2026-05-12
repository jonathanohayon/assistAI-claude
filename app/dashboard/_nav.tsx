"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard", label: "Configuration" },
  { href: "/dashboard/calendar", label: "Calendrier" },
  { href: "/dashboard/contacts", label: "Contacts" },
  { href: "/dashboard/billing", label: "Abonnement" },
  { href: "/dashboard/logs", label: "Logs" },
];

export function DashboardTabs() {
  const pathname = usePathname();
  return (
    <nav className="mx-auto w-full max-w-5xl px-4 pt-4 sm:px-6 sm:pt-6">
      {/* Sur mobile, le pill devient scrollable horizontalement avec snap.
          Sur sm+, reste un inline-flex non-scrollable comme avant. */}
      <div className="scroll-visible -mx-1 overflow-x-auto pb-1">
        <div className="inline-flex min-w-min rounded-full border border-[var(--color-border)] bg-white p-1 shadow-xs">
          {TABS.map((t) => {
            const active = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 sm:text-sm ${
                  active
                    ? "bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-white shadow-sm"
                    : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
