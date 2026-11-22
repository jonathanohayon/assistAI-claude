"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useTranslations } from "next-intl";

import type { Door } from "@/lib/door-values";
import { doorUi } from "@/lib/doors-ui";

import { ADMIN_TABS } from "./nav-tabs";

// Mirror visuel de /[locale]/dashboard/_nav.tsx mais sans i18n et avec
// les URLs préfixées /admin/users/[userId]. Onglet actif détecté via
// pathname strict (égalité exacte sur le suffixe). Like the tenant's menu:
// the home tab first, named after the tenant's door (French messages of the
// admin layout's provider).
export function AdminTenantTabs({ userId, door }: { userId: string; door?: Door | null }) {
  const t = useTranslations("Dashboard");
  const pathname = usePathname();
  const base = `/admin/users/${userId}`;
  const TABS = ADMIN_TABS.map((tab) => (tab.id === "home" ? { ...tab, label: t(doorUi(door).headerKey) } : tab));
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
                    ? "bg-gradient-to-br from-[var(--color-primary)] to-[#be185d] text-white shadow-sm"
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
