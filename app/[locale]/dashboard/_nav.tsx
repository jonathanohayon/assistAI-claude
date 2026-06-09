"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";

import { Link } from "@/i18n/navigation";
import type { FeatureKey, PlanFeatures } from "@/lib/plan-features";

interface Tab {
  href: string;
  labelKey: string;
  // Si défini, l'onglet n'apparaît que si la feature est activée pour le
  // plan du tenant (matrice admin éditable). Sans gate = toujours visible.
  feature?: FeatureKey;
}

const TABS: ReadonlyArray<Tab> = [
  { href: "/dashboard", labelKey: "tabConfiguration" },
  {
    href: "/dashboard/campaigns",
    labelKey: "tabOutbound",
    feature: "outbound_campaigns",
  },
  { href: "/dashboard/calendar", labelKey: "tabCalendar", feature: "calendar" },
  { href: "/dashboard/contacts", labelKey: "tabContacts", feature: "crm" },
  { href: "/dashboard/billing", labelKey: "tabBilling" },
  { href: "/dashboard/logs", labelKey: "tabLogs" },
];

export function DashboardTabs({
  features,
  isAdmin = false,
}: {
  features: PlanFeatures;
  // Admins voient TOUS les onglets indépendamment de leur plan DB (ils
  // n'en ont pas de "vrai" — le seed pose "essential" par défaut qui ne
  // matche aucun PlanKey). Sans ce bypass, certains onglets seraient
  // masqués selon la matrice côté admin.
  isAdmin?: boolean;
}) {
  const t = useTranslations("Dashboard");
  const pathname = usePathname();
  const visibleTabs = TABS.filter(
    (tab) => isAdmin || !tab.feature || features[tab.feature],
  );
  // next-intl/navigation/usePathname renvoie le pathname SANS la locale
  // prefix (ex: "/dashboard/calendar" même quand l'URL est "/he/dashboard/..."),
  // donc on compare directement aux hrefs de TABS. Le Link locale-aware
  // s'occupe d'ajouter la locale au rendu côté href.
  // ⚠️ usePathname importé depuis next/navigation, pas next-intl — sur
  // app router avec localePrefix:'always' il garde le préfixe. On strip
  // donc manuellement la locale (premier segment fr|he|en) pour matcher.
  const stripLocale = (p: string): string => {
    const m = p.match(/^\/(fr|he|en)(\/.*)?$/);
    return m ? m[2] || "/" : p;
  };
  const cleanPath = stripLocale(pathname);
  return (
    <nav className="relative z-10 mx-auto w-full max-w-5xl px-4 pt-4 sm:px-6 sm:pt-6">
      <div className="scroll-visible -mx-1 overflow-x-auto pb-1">
        <div className="inline-flex min-w-min rounded-full border border-[var(--color-border)] bg-white p-1 shadow-xs">
          {visibleTabs.map((tab) => {
            const active = cleanPath === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 sm:text-sm ${
                  active
                    ? "bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-white shadow-sm"
                    : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                }`}
              >
                {t(tab.labelKey)}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
