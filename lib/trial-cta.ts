// "Essayer gratuitement" (F4): what a product page shows about the
// per-product trial, from the entry's menu state and its trial state.
// PURE and client-safe: type-only imports, no env, no db, no fetch.
// scripts/tests/trial-cta.test.ts pins the whole table.
//
// The trial state is accountProducts(userId).trials[entry] (lib/products.ts),
// read through a NARROW type: `startable` is the BE's own decision (shared
// with POST /api/dashboard/products/trial: true means that POST would return
// 201). It is never derived here from flags or caps; missing = not startable.
//
//   menu owned                        → "owned"  (nothing), or "active" while a trial runs
//   preview "soon"                    → "soon"   (unchanged: "Prévenez-moi")
//   preview "try", trial active       → "active" ("Essai en cours jusqu'au {date}", no button)
//   preview "try", trial used         → "used"   ("Votre essai est terminé." + "Voir l'offre")
//   preview "try", available AND startable === true
//                                     → "start"  ("Essayer gratuitement" + the terms line)
//   preview "try", anything else      → "offer"  ("Voir l'offre" only: no trial button
//                                       that the server would refuse)

import type { ProductEntryState } from "./product-menu";

/** The fields of accountProducts().trials[entry] this module reads. */
export type TrialCtaTrial =
  | {
      state?: "available" | "used" | "active";
      endsAt?: string;
      /** The BE's start decision (true = the POST would return 201). Absent = false. */
      startable?: boolean;
    }
  | null
  | undefined;

export type TrialCtaView =
  | { kind: "owned" }
  | { kind: "soon" }
  | { kind: "start" }
  | { kind: "active"; endsAt: string }
  | { kind: "used" }
  | { kind: "offer" };

function activeEnd(trial: TrialCtaTrial): string | null {
  if (trial?.state !== "active" || typeof trial.endsAt !== "string") return null;
  return Number.isFinite(Date.parse(trial.endsAt)) ? trial.endsAt : null;
}

export function trialCta(entry: ProductEntryState, trial: TrialCtaTrial): TrialCtaView {
  const end = activeEnd(trial);
  if (entry.state === "owned") return end ? { kind: "active", endsAt: end } : { kind: "owned" };
  if (entry.cta === "soon") return { kind: "soon" };
  if (end) return { kind: "active", endsAt: end };
  if (trial?.state === "used") return { kind: "used" };
  if (trial?.state === "available" && trial.startable === true) return { kind: "start" };
  return { kind: "offer" };
}
