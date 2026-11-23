"use client";

/**
 * The header of a product page the account does NOT own (lib/product-menu.ts
 * "preview"): the product's name as the page title, one plain sentence on
 * what it does, then:
 *   - cta "try": what the per-product trial allows (lib/trial-cta.ts, F4):
 *       start  (available AND the BE says startable): ONE button, "Essayer
 *              gratuitement" (POST /api/dashboard/products/trial,
 *              lib/trial-start.ts), and one line with the trial terms read
 *              from lib/product-trials.ts (passed by the server page);
 *       active "Essai en cours jusqu'au {date}", no button;
 *       used   "Votre essai est terminé." and the offer link;
 *       offer  (not startable) the offer link only, "Voir l'offre": never a
 *              trial button the server would refuse.
 *     The offer link is the existing upsell path: for Sales, the campaigns
 *     upsell modal; for the other products, the subscription page.
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

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { UpsellModal } from "@/app/[locale]/dashboard/campaigns/upsell-modal";
import { Link } from "@/i18n/navigation";
import type { ProductCta } from "@/lib/product-menu";
import { notifySubmitter, postNotify, type NotifyPhase } from "@/lib/notify-me";
import type { ProductEntry } from "@/lib/product-values";
import { trialCta, type TrialCtaTrial, type TrialCtaView } from "@/lib/trial-cta";
import { postTrialStart, trialStartSubmitter, type TrialStartOutcome } from "@/lib/trial-start";

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

/** The trial terms shown under "Essayer gratuitement" (lib/product-trials.ts, read by the server page). */
export type TrialTerms = { days: number; minutes: number };

/** What the start block shows, by phase. "refreshing" = 201/owned, the page is re-rendering. */
export type TrialStartPhase = "idle" | "pending" | "refreshing" | "used" | "unavailable" | "error";

const TRIAL_ERROR_KEY = {
  used: "previewTrialErrorUsed",
  unavailable: "previewTrialErrorUnavailable",
  error: "previewTrialError",
} as const;

/** The "start" block by phase (rendered as-is by the tests). */
export function TrialStartView({
  entry,
  phase,
  terms,
  onStart,
}: {
  entry: ProductEntry;
  phase: TrialStartPhase;
  terms: TrialTerms;
  onStart?: () => void;
}) {
  const t = useTranslations("DashboardNav");
  const busy = phase === "pending" || phase === "refreshing";
  // trial_used / product_unavailable: the server will refuse again, so the
  // button goes; a generic failure keeps it for a retry.
  const refused = phase === "used" || phase === "unavailable";
  return (
    <div className="mt-5">
      {!refused && (
        <button
          type="button"
          className={`${BUTTON} disabled:cursor-wait disabled:opacity-70`}
          onClick={onStart}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {t("previewTry")}
        </button>
      )}
      <p className="mt-2 text-sm text-[#475569]">{t("previewTrialTerms", terms)}</p>
      {(phase === "used" || phase === "unavailable" || phase === "error") && (
        <p className="mt-2 text-sm text-[#b91c1c]" role="alert">
          {t(TRIAL_ERROR_KEY[phase], { product: t(entry) })}
        </p>
      )}
    </div>
  );
}

function TrialStart({ entry, terms, asUserId }: { entry: ProductEntry; terms: TrialTerms; asUserId?: string | null }) {
  const router = useRouter();
  const [phase, setPhase] = useState<TrialStartPhase>("idle");
  const [refreshing, startRefresh] = useTransition();
  // One request at a time, whatever the click rate (the disabled button
  // only lands after a render).
  const [submit] = useState(() => trialStartSubmitter(() => postTrialStart(entry, asUserId)));
  const onStart = async () => {
    if (phase === "refreshing") return;
    const pendingSubmit = submit();
    setPhase("pending");
    const outcome: TrialStartOutcome | null = await pendingSubmit;
    if (!outcome) return;
    if (outcome === "started" || outcome === "refresh") {
      // The re-rendered page shows the product owned. If this header is
      // still mounted once the refresh lands, the button comes back (a new
      // click is answered by the server): never an endless spinner.
      setPhase("refreshing");
      startRefresh(() => router.refresh());
      return;
    }
    setPhase(outcome);
  };
  const shown: TrialStartPhase = phase === "refreshing" && !refreshing ? "idle" : phase;
  return <TrialStartView entry={entry} phase={shown} terms={terms} onStart={onStart} />;
}

/** "Essai en cours jusqu'au {date}" (an active per-product trial), no button. */
export function TrialActiveLine({ endsAt, className = "mt-4" }: { endsAt: string; className?: string }) {
  const t = useTranslations("DashboardNav");
  const format = useFormatter();
  const date = format.dateTime(new Date(endsAt), { day: "numeric", month: "long", year: "numeric" });
  return (
    <p className={`${className} text-sm font-semibold text-[#9d174d]`} role="status">
      {t("previewTrialActive", { date })}
    </p>
  );
}

/** The offer link: the existing upsell path (Sales: the campaigns modal; others: the subscription page). */
function OfferLink({ entry }: { entry: ProductEntry }) {
  const t = useTranslations("DashboardNav");
  const [upsellOpen, setUpsellOpen] = useState(false);
  if (entry === "sales")
    return (
      <>
        <button type="button" className={BUTTON} onClick={() => setUpsellOpen(true)}>
          {t("previewOffer")}
        </button>
        <UpsellModal open={upsellOpen} onClose={() => setUpsellOpen(false)} />
      </>
    );
  return (
    <Link href="/dashboard/billing" className={BUTTON}>
      {t("previewOffer")}
    </Link>
  );
}

export function ProductPreviewHeader({
  entry,
  cta,
  notifyRequested = false,
  trial,
  trialTerms,
  asUserId,
}: {
  entry: ProductEntry;
  cta: ProductCta;
  /** The account already asked to be told about this entry (accountProducts.notifyRequested). */
  notifyRequested?: boolean;
  /** accountProducts(userId).trials[entry]; absent = no trial button. */
  trial?: TrialCtaTrial;
  /** The trial terms (lib/product-trials.ts), passed by the server page. Absent = no trial button. */
  trialTerms?: TrialTerms;
  /** Admin tenant view only: the POSTs carry ?asUserId (no such header there today). */
  asUserId?: string | null;
}) {
  const t = useTranslations("DashboardNav");
  const computed: TrialCtaView = trialCta({ state: "preview", cta }, trial);
  // No terms to state = no button: the start block always says what it starts.
  const view: TrialCtaView = computed.kind === "start" && !trialTerms ? { kind: "offer" } : computed;
  return (
    <header className="mb-8" data-preview={cta} data-trial={view.kind}>
      <h1 className="font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">{t(entry)}</h1>
      <p className="mt-3 max-w-2xl text-sm text-[#475569] sm:text-base">{t(PITCH_KEY[entry])}</p>
      {view.kind === "soon" ? (
        <>
          <p className="mt-4 text-sm font-semibold text-[#9d174d]">{t("previewSoon")}</p>
          <NotifyMe entry={entry} notifyRequested={notifyRequested} asUserId={asUserId} />
        </>
      ) : view.kind === "start" && trialTerms ? (
        <TrialStart entry={entry} terms={trialTerms} asUserId={asUserId} />
      ) : view.kind === "active" ? (
        <TrialActiveLine endsAt={view.endsAt} />
      ) : view.kind === "used" ? (
        <>
          <p className="mt-4 text-sm font-semibold text-[#9d174d]">{t("previewTrialUsed")}</p>
          <div className="mt-4">
            <OfferLink entry={entry} />
          </div>
        </>
      ) : (
        <div className="mt-5">
          <OfferLink entry={entry} />
        </div>
      )}
    </header>
  );
}
