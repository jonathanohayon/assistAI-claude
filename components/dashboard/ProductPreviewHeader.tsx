"use client";

/**
 * The header of a product page the account does NOT own (lib/product-menu.ts
 * "preview"): the product's name as the page title, one plain sentence on
 * what it does, then either "Coming soon." (cta "soon") or the existing upsell
 * button (cta "try"): for Sales, the campaigns upsell modal; for the other
 * products, the subscription page. Owned pages never render it.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

import { UpsellModal } from "@/app/[locale]/dashboard/campaigns/upsell-modal";
import { Link } from "@/i18n/navigation";
import type { ProductCta } from "@/lib/product-menu";
import type { ProductEntry } from "@/lib/product-values";

const PITCH_KEY: Record<ProductEntry, "pitchReception" | "pitchSales" | "pitchConnect"> = {
  reception: "pitchReception",
  sales: "pitchSales",
  connect: "pitchConnect",
};

const BUTTON =
  "inline-flex items-center rounded-full bg-[#be185d] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#9d174d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2";

export function ProductPreviewHeader({ entry, cta }: { entry: ProductEntry; cta: ProductCta }) {
  const t = useTranslations("DashboardNav");
  const tSetup = useTranslations("DashboardSetup");
  const [upsellOpen, setUpsellOpen] = useState(false);
  return (
    <header className="mb-8" data-preview={cta}>
      <h1 className="font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">{t(entry)}</h1>
      <p className="mt-3 max-w-2xl text-sm text-[#475569] sm:text-base">{t(PITCH_KEY[entry])}</p>
      {cta === "soon" ? (
        <p className="mt-4 text-sm font-semibold text-[#9d174d]">{t("previewSoon")}</p>
      ) : entry === "sales" ? (
        <>
          <button type="button" className={`mt-5 ${BUTTON}`} onClick={() => setUpsellOpen(true)}>
            {tSetup("contactsLockedCta")}
          </button>
          <UpsellModal open={upsellOpen} onClose={() => setUpsellOpen(false)} />
        </>
      ) : (
        <Link href="/dashboard/billing" className={`mt-5 ${BUTTON}`}>
          {tSetup("contactsLockedCta")}
        </Link>
      )}
    </header>
  );
}
