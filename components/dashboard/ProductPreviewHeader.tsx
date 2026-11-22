"use client";

/**
 * The header of a product page the account does NOT own (lib/product-menu.ts
 * "preview"): the product's name as the page title, one plain sentence on
 * what it does, then:
 *   - cta "try":  ONE button, "Essayer gratuitement", to the existing upsell
 *     path: for Sales, the campaigns upsell modal; for the other products,
 *     the subscription page. (F4 wires it to per-product trials.)
 *   - cta "soon": the plain line "Bientôt disponible.", then ONE button,
 *     "Prévenez-moi" (POST /api/dashboard/products/notify, lib/notify-me.ts).
 *     Once stored (201, or 200 = already stored) the button gives way to
 *     "C'est noté, nous vous préviendrons."; an account that already asked
 *     (notifyRequested, loaded by the server page) sees that line directly.
 *     409 (the product is owned): nothing more, the page reflects it on
 *     reload. Any other failure: a plain inline error, the button stays.
 *     No email is sent; the request is only stored.
 * The page shows the product's real screen over sample data below it.
 * Owned pages never render it.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

import { UpsellModal } from "@/app/[locale]/dashboard/campaigns/upsell-modal";
import { Link } from "@/i18n/navigation";
import type { ProductCta } from "@/lib/product-menu";
import { notifySubmitter, postNotify, type NotifyPhase } from "@/lib/notify-me";
import type { ProductEntry } from "@/lib/product-values";

const PITCH_KEY: Record<ProductEntry, "pitchReception" | "pitchSales" | "pitchConnect"> = {
  reception: "pitchReception",
  sales: "pitchSales",
  connect: "pitchConnect",
};

const BUTTON =
  "inline-flex min-h-11 items-center rounded-full bg-[#be185d] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#9d174d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2";

/** The notify-me block of a "soon" page, by phase (rendered as-is by the tests). */
export function NotifyMeView({ phase, onNotify }: { phase: NotifyPhase; onNotify?: () => void }) {
  const t = useTranslations("DashboardNav");
  if (phase === "gone") return null;
  if (phase === "done") return <p className="mt-3 text-sm text-[#334155]" role="status">{t("previewNotified")}</p>;
  const pending = phase === "pending";
  return (
    <div className="mt-4">
      <button
        type="button"
        className={`${BUTTON} disabled:cursor-wait disabled:opacity-70`}
        onClick={onNotify}
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {t("previewNotify")}
      </button>
      {phase === "error" && (
        <p className="mt-2 text-sm text-[#b91c1c]" role="alert">
          {t("previewNotifyError")}
        </p>
      )}
    </div>
  );
}

function NotifyMe({ entry, notifyRequested, asUserId }: { entry: ProductEntry; notifyRequested: boolean; asUserId?: string | null }) {
  const [phase, setPhase] = useState<NotifyPhase>(notifyRequested ? "done" : "idle");
  // One request at a time, whatever the click rate (the disabled button
  // only lands after a render).
  const [submit] = useState(() => notifySubmitter(() => postNotify(entry, asUserId)));
  const onNotify = async () => {
    const pendingSubmit = submit();
    setPhase("pending");
    const outcome = await pendingSubmit;
    if (outcome) setPhase(outcome);
  };
  return <NotifyMeView phase={phase} onNotify={onNotify} />;
}

export function ProductPreviewHeader({
  entry,
  cta,
  notifyRequested = false,
  asUserId,
}: {
  entry: ProductEntry;
  cta: ProductCta;
  /** The account already asked to be told about this entry (accountProducts.notifyRequested). */
  notifyRequested?: boolean;
  /** Admin tenant view only: the POST carries ?asUserId (no such header there today). */
  asUserId?: string | null;
}) {
  const t = useTranslations("DashboardNav");
  const [upsellOpen, setUpsellOpen] = useState(false);
  return (
    <header className="mb-8" data-preview={cta}>
      <h1 className="font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">{t(entry)}</h1>
      <p className="mt-3 max-w-2xl text-sm text-[#475569] sm:text-base">{t(PITCH_KEY[entry])}</p>
      {cta === "soon" ? (
        <>
          <p className="mt-4 text-sm font-semibold text-[#9d174d]">{t("previewSoon")}</p>
          <NotifyMe entry={entry} notifyRequested={notifyRequested} asUserId={asUserId} />
        </>
      ) : entry === "sales" ? (
        <div className="mt-5">
          <button type="button" className={BUTTON} onClick={() => setUpsellOpen(true)}>
            {t("previewTry")}
          </button>
          <UpsellModal open={upsellOpen} onClose={() => setUpsellOpen(false)} />
        </div>
      ) : (
        <div className="mt-5">
          <Link href="/dashboard/billing" className={BUTTON}>
            {t("previewTry")}
          </Link>
        </div>
      )}
    </header>
  );
}
