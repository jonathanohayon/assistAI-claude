"use client";

/**
 * On an OWNED product page: "Essai en cours jusqu'au {date}" while the
 * account's per-product trial on that entry is active (lib/trial-cta.ts
 * "active"), nothing otherwise. No button: the trial runs by itself.
 * Date only: the minutes left (lib/product-trials.ts trialUsage, carried by
 * usageByProduct) reach only the billing-stats API, not the data this page
 * receives (accountProducts().trials), and it adds no fetch for them.
 */

import { TrialActiveLine } from "@/components/dashboard/ProductPreviewHeader";
import { trialCta, type TrialCtaTrial } from "@/lib/trial-cta";

export function ProductTrialNote({ trial, inline = false }: { trial: TrialCtaTrial; inline?: boolean }) {
  const view = trialCta({ state: "owned" }, trial);
  if (view.kind !== "active") return null;
  const line = <TrialActiveLine endsAt={view.endsAt} className="" />;
  if (inline) return <div data-trial="active">{line}</div>;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6" data-trial="active">
      {line}
    </div>
  );
}
