"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Tab {
  href: string;
  label: string;
  /** Si défini, l'onglet n'apparaît que pour les plans listés. Onglets
   *  Calendrier/Contacts dépendent du Google Calendar perso = Globale+ */
  plansOnly?: ReadonlyArray<"whatsapp" | "global" | "premium">;
}

const TABS: ReadonlyArray<Tab> = [
  { href: "/dashboard", label: "Configuration" },
  { href: "/dashboard/calendar", label: "Calendrier", plansOnly: ["global", "premium"] },
  { href: "/dashboard/contacts", label: "Contacts", plansOnly: ["global", "premium"] },
  { href: "/dashboard/billing", label: "Abonnement" },
  { href: "/dashboard/logs", label: "Logs" },
];

export function DashboardTabs({
  subscriptionPlan,
  isAdmin = false,
}: {
  subscriptionPlan: "whatsapp" | "global" | "premium";
  // Admins voient TOUS les onglets indépendamment de leur plan DB (ils
  // n'en ont pas de "vrai" — le seed pose "essential" par défaut qui ne
  // matche aucun PlanKey). Sans ce bypass, le filtre cache Calendrier/CRM.
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const visibleTabs = TABS.filter(
    (t) => isAdmin || !t.plansOnly || t.plansOnly.includes(subscriptionPlan),
  );
  return (
    <nav className="mx-auto w-full max-w-5xl px-4 pt-4 sm:px-6 sm:pt-6">
      <div className="scroll-visible -mx-1 overflow-x-auto pb-1">
        <div className="inline-flex min-w-min rounded-full border border-[var(--color-border)] bg-white p-1 shadow-xs">
          {visibleTabs.map((t) => {
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
