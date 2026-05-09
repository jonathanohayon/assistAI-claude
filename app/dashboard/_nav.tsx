"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard", label: "Configuration" },
  { href: "/dashboard/calendar", label: "Calendrier" },
  { href: "/dashboard/contacts", label: "Contacts" },
  { href: "/dashboard/logs", label: "Logs" },
];

export function DashboardTabs() {
  const pathname = usePathname();
  return (
    <nav className="mx-auto w-full max-w-5xl px-6 pt-6">
      <div className="inline-flex rounded-full border border-[var(--color-border)] bg-white p-1 shadow-xs">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
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
    </nav>
  );
}
