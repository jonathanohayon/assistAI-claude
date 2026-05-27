"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Tab {
  hrefSuffix: string;
  label: string;
}

const TABS: ReadonlyArray<Tab> = [
  { hrefSuffix: "", label: "Configuration" },
  { hrefSuffix: "/calendar", label: "Calendrier" },
  { hrefSuffix: "/contacts", label: "CRM" },
  { hrefSuffix: "/logs", label: "Monitoring" },
];

// Mirror visuel de /[locale]/dashboard/_nav.tsx mais sans i18n et avec
// les URLs préfixées /admin/users/[userId]. Onglet actif détecté via
// pathname strict (égalité exacte sur le suffixe).
export function AdminTenantTabs({ userId }: { userId: string }) {
  const pathname = usePathname();
  const base = `/admin/users/${userId}`;
  return (
    <nav className="relative z-10 mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 sm:pt-6">
      <div className="scroll-visible -mx-1 overflow-x-auto pb-1">
        <div className="inline-flex min-w-min rounded-full border border-[var(--color-border)] bg-white p-1 shadow-xs">
          {TABS.map((tab) => {
            const href = `${base}${tab.hrefSuffix}`;
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 sm:text-sm ${
                  active
                    ? "bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-white shadow-sm"
                    : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
