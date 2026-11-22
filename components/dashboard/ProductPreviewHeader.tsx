"use client";

/**
 * The header of a product page the account does NOT own (lib/product-menu.ts
 * "preview"): the product's name as the page title, one plain sentence on
 * what it does, then ONE button (F2):
 *   - cta "try":  "Essayer gratuitement", to the existing upsell path: for
 *     Sales, the campaigns upsell modal; for the other products, the
 *     subscription page. (F4 wires it to per-product trials.)
 *   - cta "soon": "Bientôt, prévenez-moi". There is no notify-me endpoint
 *     yet: the click records NOTHING on the server, it only says "Nous vous
 *     préviendrons." on this page (never stored, never sent).
 * The page shows the product's real screen over sample data below it.
 * Owned pages never render it.
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
  "inline-flex min-h-11 items-center rounded-full bg-[#be185d] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#9d174d] disabled:cursor-default disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2";

export function ProductPreviewHeader({ entry, cta }: { entry: ProductEntry; cta: ProductCta }) {
  const t = useTranslations("DashboardNav");
  const [upsellOpen, setUpsellOpen] = useState(false);
  // "Prévenez-moi": local only (no endpoint yet), for this page view.
  const [notified, setNotified] = useState(false);
  return (
    <header className="mb-8" data-preview={cta}>
      <h1 className="font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">{t(entry)}</h1>
      <p className="mt-3 max-w-2xl text-sm text-[#475569] sm:text-base">{t(PITCH_KEY[entry])}</p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {cta === "soon" ? (
          <>
            <button type="button" className={BUTTON} onClick={() => setNotified(true)} aria-pressed={notified} aria-describedby={notified ? `notify-${entry}` : undefined}>
              {t("previewNotify")}
            </button>
            <p id={`notify-${entry}`} role="status" aria-live="polite" className="text-sm font-semibold text-[#0e7490]">
              {notified ? t("previewNotified") : ""}
            </p>
          </>
        ) : entry === "sales" ? (
          <>
            <button type="button" className={BUTTON} onClick={() => setUpsellOpen(true)}>
              {t("previewTry")}
            </button>
            <UpsellModal open={upsellOpen} onClose={() => setUpsellOpen(false)} />
          </>
        ) : (
          <Link href="/dashboard/billing" className={BUTTON}>
            {t("previewTry")}
          </Link>
        )}
      </div>
    </header>
  );
}
