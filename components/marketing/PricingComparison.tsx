"use client";

// Tableau comparatif des 3 plans, affiché sous la grille de PlanCard sur la
// landing (components/marketing/Pricing.tsx). Objectif produit : rendre la
// valeur du Premium évidente, notamment la ligne "appels sortants" (le vrai
// différenciateur). La colonne Premium est subtilement mise en avant et la
// ligne outbound est teintée primaire.
//
// Source plans = @/lib/plans (PLANS). Noms localisés via le namespace
// "Plans" (mêmes clés que PlanCard) ; libellés de lignes via le namespace
// "PricingComparison".

import { useTranslations } from "next-intl";

import { PLANS, type PlanKey } from "@/lib/plans";

/** "Oui" — coche dans un cercle teinté primaire. */
function YesIcon({ label }: { label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--color-primary)]"
      style={{ backgroundColor: "color-mix(in srgb, var(--color-primary) 14%, transparent)" }}
    >
      <svg viewBox="0 0 20 20" fill="none" aria-hidden className="h-3.5 w-3.5">
        <path
          d="m6 10.5 2.5 2.5L14 7.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** "Non" — tiret gris discret. */
function NoIcon({ label }: { label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-flex h-6 w-6 items-center justify-center text-slate-300"
    >
      <svg viewBox="0 0 20 20" fill="none" aria-hidden className="h-4 w-4">
        <path
          d="M6 10h8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/** Cellule = booléen (oui/non), ou texte libre (ex: "Standard", "300"). */
type Cell = boolean | string;

type Row = {
  /** Clé i18n du libellé de ligne (namespace PricingComparison). */
  labelKey: string;
  /** Valeurs par plan, dans l'ordre de PLANS (whatsapp, global, premium). */
  values: [Cell, Cell, Cell];
  /** Ligne différenciante mise en évidence (appels sortants). */
  highlight?: boolean;
};

export function PricingComparison() {
  const t = useTranslations("PricingComparison");
  const tPlans = useTranslations("Plans");

  const planName = (key: PlanKey) => {
    try {
      return tPlans(`${key}.name`);
    } catch {
      return key;
    }
  };

  const rows: Row[] = [
    { labelKey: "rowMinutes", values: ["300", "500", "1500"] },
    { labelKey: "rowInbound", values: [true, true, true] },
    { labelKey: "rowMessages", values: [true, true, true] },
    { labelKey: "rowCalendar", values: [false, true, true] },
    { labelKey: "rowCrm", values: [false, true, true] },
    { labelKey: "rowOutbound", values: [false, false, true], highlight: true },
    { labelKey: "rowMulticall", values: [false, false, true] },
    { labelKey: "rowAnalytics", values: [false, false, true] },
    {
      labelKey: "rowSupport",
      values: [false, t("supportStandard"), t("supportPriority")],
    },
  ];

  const renderCell = (value: Cell) => {
    if (typeof value === "boolean") {
      return value ? <YesIcon label={t("yes")} /> : <NoIcon label={t("no")} />;
    }
    return (
      <span className="text-sm font-medium text-[var(--color-foreground)]">
        {value}
      </span>
    );
  };

  // Index de la colonne Premium pour la mise en avant (dernière de PLANS).
  const premiumIndex = PLANS.findIndex((p) => p.key === "premium");

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h3 className="text-center font-display text-2xl tracking-tight text-[var(--color-foreground)] sm:text-3xl">
        {t("title")}
      </h3>

      {/* Scroll horizontal contrôlé sur mobile : le tableau garde une largeur
          minimale lisible, mais le débordement reste confiné à ce conteneur
          (pas de scroll horizontal sur toute la page). */}
      <div className="mt-8 overflow-x-auto rounded-2xl border border-[var(--color-border)] bg-white/80 shadow-sm backdrop-blur">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <caption className="sr-only">{t("title")}</caption>
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th
                scope="col"
                className="px-5 py-4 text-xs font-semibold uppercase tracking-widest text-[var(--color-muted-foreground)]"
              >
                {t("forWho")}
              </th>
              {PLANS.map((plan, i) => {
                const isPremium = i === premiumIndex;
                return (
                  <th
                    key={plan.key}
                    scope="col"
                    className={`px-5 py-4 text-center align-bottom ${
                      isPremium
                        ? "bg-[color-mix(in_srgb,var(--color-primary)_6%,transparent)]"
                        : ""
                    }`}
                  >
                    <span className="block font-display text-base text-[var(--color-foreground)]">
                      {planName(plan.key)}
                    </span>
                    <span className="mt-1 block text-[11px] font-normal leading-snug text-[var(--color-muted-foreground)]">
                      {i === 0
                        ? t("forWhoWhatsapp")
                        : i === 1
                          ? t("forWhoGlobal")
                          : t("forWhoPremium")}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.labelKey}
                className={`border-b border-[var(--color-border)]/70 last:border-0 ${
                  row.highlight
                    ? "bg-[color-mix(in_srgb,var(--color-primary)_8%,transparent)]"
                    : ""
                }`}
              >
                <th
                  scope="row"
                  className={`px-5 py-3.5 text-sm font-normal text-[var(--color-foreground)] ${
                    row.highlight ? "font-semibold" : ""
                  }`}
                >
                  {t(row.labelKey)}
                </th>
                {row.values.map((value, i) => {
                  const isPremium = i === premiumIndex;
                  return (
                    <td
                      key={i}
                      className={`px-5 py-3.5 text-center ${
                        isPremium && !row.highlight
                          ? "bg-[color-mix(in_srgb,var(--color-primary)_6%,transparent)]"
                          : ""
                      } ${
                        isPremium && row.highlight ? "font-semibold" : ""
                      }`}
                    >
                      {renderCell(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
